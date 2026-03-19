package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/mattermost/mattermost-server/v6/model"
	"github.com/mattermost/mattermost-server/v6/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin
}

type ScheduledMessage struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	ChannelID    string    `json:"channel_id"`
	ChannelName  string    `json:"channel_name"`
	Message      string    `json:"message"`
	FileIDs      []string  `json:"file_ids"`      // ID загруженных файлов
	Filenames    []string  `json:"filenames"`     // Имена файлов для отображения
	ScheduleTime time.Time `json:"schedule_time"`
	CreatedAt    time.Time `json:"created_at"`
	IsSent       bool      `json:"is_sent"`
}

func (p *Plugin) OnActivate() error {
	p.API.LogInfo("Плагин планировщика активирован")
	go p.checkScheduledMessages()
	return nil
}

func (p *Plugin) checkScheduledMessages() {
	p.API.LogInfo("Запуск проверки запланированных сообщений")
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		p.processScheduledMessages()
	}
}

func (p *Plugin) processScheduledMessages() {
	now := time.Now()
	p.API.LogDebug("Проверка запланированных сообщений", "time", now.Format("2006-01-02 15:04:05"))
	
	keys, appErr := p.API.KVList(0, 1000)
	if appErr != nil {
		p.API.LogError("Не удалось получить список ключей", "error", appErr.Error())
		return
	}

	p.API.LogDebug("Найдено ключей", "count", len(keys))

	for _, key := range keys {
		var msg ScheduledMessage
		data, appErr := p.API.KVGet(key)
		if appErr != nil || data == nil {
			continue
		}
		
		if err := json.Unmarshal(data, &msg); err != nil {
			p.API.LogError("Ошибка разбора сообщения", "key", key, "error", err.Error())
			continue
		}
		
		p.API.LogDebug("Проверка сообщения", 
			"id", msg.ID,
			"channel", msg.ChannelID,
			"schedule", msg.ScheduleTime.Format("2006-01-02 15:04:05"),
			"now", now.Format("2006-01-02 15:04:05"),
			"is_sent", msg.IsSent)
		
		// Отправляем если время наступило и еще не отправлено
		if !msg.IsSent && msg.ScheduleTime.Before(now) {
			p.API.LogInfo("Время отправлять сообщение", 
				"id", msg.ID,
				"channel", msg.ChannelID,
				"scheduled_time", msg.ScheduleTime.Format("2006-01-02 15:04:05"))
			
			// Пытаемся отправить
			success := p.sendScheduledMessage(msg)
			
			if success {
				// Отмечаем как отправленное только если успешно отправили
				msg.IsSent = true
				data, _ := json.Marshal(msg)
				p.API.KVSet(msg.ID, data)
				p.API.LogInfo("Сообщение отправлено и отмечено как доставленное", "id", msg.ID)
			} else {
				p.API.LogError("Не удалось отправить сообщение, будет повтор через 10 секунд", "id", msg.ID)
				// НЕ отмечаем как отправленное, чтобы попробовать снова
			}
		}
	}
}

func (p *Plugin) sendScheduledMessage(msg ScheduledMessage) bool {
	p.API.LogInfo("Попытка отправить запланированное сообщение", 
		"id", msg.ID,
		"channel", msg.ChannelID,
		"user", msg.UserID,
		"files", len(msg.FileIDs))

	// Проверяем существование канала
	channel, appErr := p.API.GetChannel(msg.ChannelID)
	if appErr != nil {
		p.API.LogError("Канал не найден", 
			"channel_id", msg.ChannelID, 
			"error", appErr.Error())
		
		p.sendNotification(msg.UserID, fmt.Sprintf("❌ Не удалось отправить сообщение: канал не найден\nТекст: %s", msg.Message))
		return false
	}

	// Проверяем существование пользователя
	user, appErr := p.API.GetUser(msg.UserID)
	if appErr != nil {
		p.API.LogError("Пользователь не найден", 
			"user_id", msg.UserID, 
			"error", appErr.Error())
		return false
	}

	// Создаем пост
	post := &model.Post{
		UserId:    msg.UserID,
		ChannelId: msg.ChannelID,
		Message:   msg.Message,
		FileIds:   msg.FileIDs, // Прикрепляем файлы к посту
		Props: map[string]interface{}{
			"scheduled":         true,
			"from_scheduler":    true,
			"original_schedule": msg.ScheduleTime.Format("2006-01-02 15:04:05"),
			"scheduled_by":      user.Username,
		},
	}

	// Если есть файлы, добавляем информацию о них в пропсы
	if len(msg.Filenames) > 0 {
		post.Props["attached_files"] = msg.Filenames
	}

	// Отправляем сообщение
	createdPost, appErr := p.API.CreatePost(post)
	if appErr != nil {
		p.API.LogError("Не удалось создать пост", 
			"error", appErr.Error(),
			"channel", msg.ChannelID,
			"user", msg.UserID)
		
		p.sendNotification(msg.UserID, fmt.Sprintf("❌ Не удалось отправить сообщение: %s\nТекст: %s", appErr.Error(), msg.Message))
		return false
	}

	// Успешно отправили
	p.API.LogInfo("Запланированное сообщение успешно отправлено", 
		"id", msg.ID,
		"post_id", createdPost.Id,
		"channel", channel.Name,
		"files", len(msg.FileIDs))

	// Отправляем уведомление об успехе
	fileInfo := ""
	if len(msg.Filenames) > 0 {
		fileInfo = fmt.Sprintf("\n📎 Вложений: %d", len(msg.Filenames))
	}
	
	p.sendNotification(msg.UserID, fmt.Sprintf("✅ Ваше сообщение отправлено в ~%s!%s\n> %s", 
		channel.DisplayName, fileInfo, msg.Message))
	
	return true
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	switch r.URL.Path {
	case "/api/v1/schedule":
		p.handleSchedule(w, r)
	case "/api/v1/list":
		p.handleList(w, r)
	case "/api/v1/cancel":
		p.handleCancel(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *Plugin) handleSchedule(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Метод не поддерживается", http.StatusMethodNotAllowed)
		return
	}

	// Парсим multipart form (макс 100MB)
	err := r.ParseMultipartForm(100 << 20) // 100 MB
	if err != nil {
		p.API.LogError("Ошибка парсинга формы", "error", err.Error())
		http.Error(w, "Ошибка обработки формы: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Получаем данные из формы
	userID := r.FormValue("user_id")
	channelID := r.FormValue("channel_id")
	message := r.FormValue("message")
	scheduleTimeStr := r.FormValue("schedule_time")

	p.API.LogInfo("Получен запрос на планирование", 
		"user_id", userID,
		"channel_id", channelID,
		"message_length", len(message),
		"schedule_time", scheduleTimeStr,
		"files", len(r.MultipartForm.File))

	// Валидация
	if userID == "" {
		http.Error(w, "user_id обязателен", http.StatusBadRequest)
		return
	}
	if channelID == "" {
		http.Error(w, "channel_id обязателен", http.StatusBadRequest)
		return
	}
	if message == "" && len(r.MultipartForm.File) == 0 {
		http.Error(w, "Нужно указать текст сообщения или прикрепить файл", http.StatusBadRequest)
		return
	}

	scheduleTime, err := time.Parse(time.RFC3339, scheduleTimeStr)
	if err != nil {
		http.Error(w, "Неверный формат времени", http.StatusBadRequest)
		return
	}

	if scheduleTime.Before(time.Now()) {
		http.Error(w, "Время должно быть в будущем", http.StatusBadRequest)
		return
	}

	// Проверяем существование канала
	channel, appErr := p.API.GetChannel(channelID)
	if appErr != nil {
		p.API.LogError("Неверный канал", 
			"channel_id", channelID, 
			"error", appErr.Error())
		http.Error(w, fmt.Sprintf("Канал не найден: %v", appErr.Error()), http.StatusBadRequest)
		return
	}

	// Загружаем файлы если есть
	var fileIDs []string
	var filenames []string

	if len(r.MultipartForm.File) > 0 {
		p.API.LogInfo("Загрузка файлов", "count", len(r.MultipartForm.File))
		
		for _, fileHeaders := range r.MultipartForm.File {
			for _, fileHeader := range fileHeaders {
				file, err := fileHeader.Open()
				if err != nil {
					p.API.LogError("Ошибка открытия файла", "error", err.Error())
					continue
				}
				defer file.Close()

				// Читаем файл в память
				data, err := io.ReadAll(file)
				if err != nil {
					p.API.LogError("Ошибка чтения файла", "error", err.Error())
					continue
				}

				// Создаем файл в Mattermost
				uploadedFile, appErr := p.API.UploadFile(data, channelID, fileHeader.Filename)
				if appErr != nil {
					p.API.LogError("Ошибка загрузки файла", 
						"filename", fileHeader.Filename, 
						"error", appErr.Error())
					continue
				}

				fileIDs = append(fileIDs, uploadedFile.Id)
				filenames = append(filenames, fileHeader.Filename)
				p.API.LogInfo("Файл загружен", "filename", fileHeader.Filename, "file_id", uploadedFile.Id)
			}
		}
	}

	// Создаем запланированное сообщение
	msg := ScheduledMessage{
		ID:           model.NewId(),
		UserID:       userID,
		ChannelID:    channelID,
		ChannelName:  channel.Name,
		Message:      message,
		FileIDs:      fileIDs,
		Filenames:    filenames,
		ScheduleTime: scheduleTime,
		CreatedAt:    time.Now(),
		IsSent:       false,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		p.API.LogError("Ошибка маршалинга сообщения", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if appErr := p.API.KVSet(msg.ID, data); appErr != nil {
		p.API.LogError("Ошибка сохранения сообщения", "error", appErr.Error())
		// Если не удалось сохранить, помечаем что файлы будут "сиротами"
		// В Mattermost нет прямого удаления файлов через API
		http.Error(w, appErr.Error(), http.StatusInternalServerError)
		return
	}

	p.API.LogInfo("Сообщение успешно запланировано", 
		"id", msg.ID,
		"user", msg.UserID,
		"channel", msg.ChannelID,
		"time", msg.ScheduleTime.Format("2006-01-02 15:04:05"),
		"files", len(fileIDs))

	// Отправляем уведомление пользователю
	fileInfo := ""
	if len(filenames) > 0 {
		fileInfo = fmt.Sprintf(" с %d вложением(ями)", len(filenames))
	}
	
	p.sendNotification(msg.UserID, fmt.Sprintf("📅 Сообщение%s запланировано на %s в канале ~%s", 
		fileInfo,
		msg.ScheduleTime.Format("2006-01-02 15:04"),
		channel.DisplayName))

	// Отправляем ответ
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      msg.ID,
		"status":  "scheduled",
		"message": "Сообщение успешно запланировано",
		"channel": channel.DisplayName,
		"time":    msg.ScheduleTime.Format("2006-01-02 15:04"),
		"files":   len(fileIDs),
	})
}

func (p *Plugin) handleList(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		http.Error(w, "user_id обязателен", http.StatusBadRequest)
		return
	}

	var messages []ScheduledMessage
	
	keys, appErr := p.API.KVList(0, 1000)
	if appErr != nil {
		p.API.LogError("Ошибка получения списка ключей", "error", appErr.Error())
		http.Error(w, appErr.Error(), http.StatusInternalServerError)
		return
	}

	for _, key := range keys {
		var msg ScheduledMessage
		data, appErr := p.API.KVGet(key)
		if appErr != nil || data == nil {
			continue
		}
		
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		
		if msg.UserID == userID && !msg.IsSent {
			messages = append(messages, msg)
		}
	}

	json.NewEncoder(w).Encode(messages)
}

func (p *Plugin) handleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Метод не поддерживается", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID     string `json:"id"`
		UserID string `json:"user_id"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	data, appErr := p.API.KVGet(req.ID)
	if appErr != nil || data == nil {
		http.Error(w, "Сообщение не найдено", http.StatusNotFound)
		return
	}

	var msg ScheduledMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		http.Error(w, "Ошибка чтения данных сообщения", http.StatusInternalServerError)
		return
	}

	if msg.UserID != req.UserID {
		http.Error(w, "Нет прав на отмену этого сообщения", http.StatusUnauthorized)
		return
	}

	// В Mattermost нет прямого API для удаления файлов по ID
	// Файлы будут удалены автоматически если не используются в постах
	// или через админ-панель при очистке

	if appErr := p.API.KVDelete(req.ID); appErr != nil {
		http.Error(w, appErr.Error(), http.StatusInternalServerError)
		return
	}

	p.sendNotification(req.UserID, "❌ Запланированное сообщение отменено")

	json.NewEncoder(w).Encode(map[string]string{
		"status":  "cancelled",
		"message": "Сообщение отменено. Файлы будут удалены системой позже.",
	})
}

func (p *Plugin) sendNotification(userID, message string) {
	post := &model.Post{
		UserId:    userID,
		ChannelId: userID,
		Message:   message,
		Type:      "custom_scheduler",
	}

	if _, appErr := p.API.CreatePost(post); appErr != nil {
		p.API.LogError("Ошибка отправки уведомления", 
			"user_id", userID, 
			"error", appErr.Error())
	}
}

func (p *Plugin) ExecuteCommand(c *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	trigger := strings.TrimPrefix(strings.Fields(args.Command)[0], "/")
	
	switch trigger {
	case "schedule_list":
		return p.listScheduledMessages(args.UserId)
	case "schedule_cancel":
		return p.cancelScheduledMessage(args.UserId, strings.Fields(args.Command))
	}
	
	return &model.CommandResponse{}, nil
}

func (p *Plugin) listScheduledMessages(userID string) (*model.CommandResponse, *model.AppError) {
	var messages []ScheduledMessage
	
	keys, appErr := p.API.KVList(0, 1000)
	if appErr != nil {
		return &model.CommandResponse{
			Text: "Ошибка получения списка сообщений",
		}, nil
	}

	for _, key := range keys {
		var msg ScheduledMessage
		data, appErr := p.API.KVGet(key)
		if appErr != nil || data == nil {
			continue
		}
		
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		
		if msg.UserID == userID && !msg.IsSent {
			messages = append(messages, msg)
		}
	}

	if len(messages) == 0 {
		return &model.CommandResponse{
			Text: "У вас нет запланированных сообщений.",
		}, nil
	}

	text := "### Ваши запланированные сообщения:\n"
	for _, msg := range messages {
		fileInfo := ""
		if len(msg.Filenames) > 0 {
			fileInfo = fmt.Sprintf(" 📎%d", len(msg.Filenames))
		}
		text += fmt.Sprintf("- `%s` в %s в ~%s%s: %s\n", 
			msg.ID[:8],
			msg.ScheduleTime.Format("2006-01-02 15:04"),
			msg.ChannelName,
			fileInfo,
			msg.Message)
	}

	return &model.CommandResponse{
		Text: text,
	}, nil
}

func (p *Plugin) cancelScheduledMessage(userID string, args []string) (*model.CommandResponse, *model.AppError) {
	if len(args) < 2 {
		return &model.CommandResponse{
			Text: "Использование: /schedule_cancel <id_сообщения>",
		}, nil
	}

	msgID := args[1]
	data, appErr := p.API.KVGet(msgID)
	if appErr != nil || data == nil {
		return &model.CommandResponse{
			Text: "Сообщение не найдено",
		}, nil
	}

	var msg ScheduledMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return &model.CommandResponse{
			Text: "Ошибка чтения данных сообщения",
		}, nil
	}

	if msg.UserID != userID {
		return &model.CommandResponse{
			Text: "Нет прав на отмену этого сообщения",
		}, nil
	}

	// В Mattermost нет прямого API для удаления файлов
	// Файлы останутся в системе как неиспользуемые

	p.API.KVDelete(msgID)
	p.sendNotification(userID, "❌ Запланированное сообщение отменено")

	return &model.CommandResponse{
		Text: "Сообщение успешно отменено",
	}, nil
}

func main() {
	plugin.ClientMain(&Plugin{})
}
