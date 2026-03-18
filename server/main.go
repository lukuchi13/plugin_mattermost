package main

import (
	"encoding/json"
	"fmt"
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
	ScheduleTime time.Time `json:"schedule_time"`
	CreatedAt    time.Time `json:"created_at"`
	IsSent       bool      `json:"is_sent"`
}

func (p *Plugin) OnActivate() error {
	p.API.LogInfo("Scheduler plugin activated")
	go p.checkScheduledMessages()
	return nil
}

func (p *Plugin) checkScheduledMessages() {
	p.API.LogInfo("Starting scheduled messages checker")
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		p.processScheduledMessages()
	}
}

func (p *Plugin) processScheduledMessages() {
	now := time.Now()
	p.API.LogDebug("Checking scheduled messages", "time", now.Format("2006-01-02 15:04:05"))
	
	keys, appErr := p.API.KVList(0, 1000)
	if appErr != nil {
		p.API.LogError("Failed to list KV keys", "error", appErr.Error())
		return
	}

	p.API.LogDebug("Found KV keys", "count", len(keys))

	for _, key := range keys {
		var msg ScheduledMessage
		data, appErr := p.API.KVGet(key)
		if appErr != nil || data == nil {
			continue
		}
		
		if err := json.Unmarshal(data, &msg); err != nil {
			p.API.LogError("Failed to unmarshal message", "key", key, "error", err.Error())
			continue
		}
		
		p.API.LogDebug("Checking message", 
			"id", msg.ID,
			"channel", msg.ChannelID,
			"schedule", msg.ScheduleTime.Format("2006-01-02 15:04:05"),
			"now", now.Format("2006-01-02 15:04:05"),
			"is_sent", msg.IsSent)
		
		// Отправляем если время наступило и еще не отправлено
		if !msg.IsSent && msg.ScheduleTime.Before(now) {
			p.API.LogInfo("Time to send message", 
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
				p.API.LogInfo("Message sent and marked as delivered", "id", msg.ID)
			} else {
				p.API.LogError("Failed to send message, will retry later", "id", msg.ID)
				// НЕ отмечаем как отправленное, чтобы попробовать снова
			}
		}
	}
}

func (p *Plugin) sendScheduledMessage(msg ScheduledMessage) bool {
	p.API.LogInfo("Attempting to send scheduled message", 
		"id", msg.ID,
		"channel", msg.ChannelID,
		"user", msg.UserID)

	// Проверяем существование канала
	channel, appErr := p.API.GetChannel(msg.ChannelID)
	if appErr != nil {
		p.API.LogError("Channel not found", 
			"channel_id", msg.ChannelID, 
			"error", appErr.Error())
		
		p.sendNotification(msg.UserID, fmt.Sprintf("❌ Cannot send scheduled message: channel not found\nMessage: %s", msg.Message))
		return false
	}

	// Проверяем существование пользователя
	user, appErr := p.API.GetUser(msg.UserID)
	if appErr != nil {
		p.API.LogError("User not found", 
			"user_id", msg.UserID, 
			"error", appErr.Error())
		return false
	}

	// Создаем пост
	post := &model.Post{
		UserId:    msg.UserID,
		ChannelId: msg.ChannelID,
		Message:   msg.Message,
		Props: map[string]interface{}{
			"scheduled": true,
			"from_scheduler": true,
			"original_schedule": msg.ScheduleTime.Format("2006-01-02 15:04:05"),
			"scheduled_by": user.Username,
		},
	}

	// Добавляем форматирование если нужно
	if strings.HasPrefix(msg.Message, "```") {
		// Это код, оставляем как есть
	} else if strings.HasPrefix(msg.Message, ">") {
		// Это цитата, оставляем как есть
	} else {
		// Обычное сообщение
	}

	// Отправляем сообщение
	createdPost, appErr := p.API.CreatePost(post)
	if appErr != nil {
		p.API.LogError("Failed to create post", 
			"error", appErr.Error(),
			"channel", msg.ChannelID,
			"user", msg.UserID)
		
		p.sendNotification(msg.UserID, fmt.Sprintf("❌ Failed to send scheduled message: %s\nMessage: %s", appErr.Error(), msg.Message))
		return false
	}

	// Успешно отправили
	p.API.LogInfo("Scheduled message sent successfully", 
		"id", msg.ID,
		"post_id", createdPost.Id,
		"channel", channel.Name)

	// Отправляем уведомление об успехе
	p.sendNotification(msg.UserID, fmt.Sprintf("✅ Your scheduled message has been sent to ~%s!\n> %s", 
		channel.DisplayName, msg.Message))
	
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var msg ScheduledMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		p.API.LogError("Failed to decode schedule request", "error", err.Error())
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	p.API.LogInfo("Received schedule request", 
		"user_id", msg.UserID,
		"channel_id", msg.ChannelID,
		"message_length", len(msg.Message),
		"schedule_time", msg.ScheduleTime)

	if msg.Message == "" {
		http.Error(w, "Message is required", http.StatusBadRequest)
		return
	}

	if msg.ChannelID == "" {
		http.Error(w, "Channel ID is required", http.StatusBadRequest)
		return
	}

	if msg.ScheduleTime.Before(time.Now()) {
		http.Error(w, "Schedule time must be in future", http.StatusBadRequest)
		return
	}

	// Проверяем существование канала
	channel, appErr := p.API.GetChannel(msg.ChannelID)
	if appErr != nil {
		p.API.LogError("Invalid channel", 
			"channel_id", msg.ChannelID, 
			"error", appErr.Error())
		http.Error(w, fmt.Sprintf("Invalid channel: %v", appErr.Error()), http.StatusBadRequest)
		return
	}
	
	msg.ChannelName = channel.Name
	msg.ID = model.NewId()
	msg.CreatedAt = time.Now()
	msg.IsSent = false

	data, err := json.Marshal(msg)
	if err != nil {
		p.API.LogError("Failed to marshal message", "error", err.Error())
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if appErr := p.API.KVSet(msg.ID, data); appErr != nil {
		p.API.LogError("Failed to save message", "error", appErr.Error())
		http.Error(w, appErr.Error(), http.StatusInternalServerError)
		return
	}

	p.API.LogInfo("Message scheduled successfully", 
		"id", msg.ID,
		"user", msg.UserID,
		"channel", msg.ChannelID,
		"time", msg.ScheduleTime.Format("2006-01-02 15:04:05"))

	p.sendNotification(msg.UserID, fmt.Sprintf("📅 Message scheduled for %s in ~%s", 
		msg.ScheduleTime.Format("2006-01-02 15:04"),
		channel.DisplayName))

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      msg.ID,
		"status":  "scheduled",
		"message": "Message scheduled successfully",
		"channel": channel.DisplayName,
		"time":    msg.ScheduleTime.Format("2006-01-02 15:04"),
	})
}

func (p *Plugin) handleList(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		http.Error(w, "user_id required", http.StatusBadRequest)
		return
	}

	var messages []ScheduledMessage
	
	keys, appErr := p.API.KVList(0, 1000)
	if appErr != nil {
		p.API.LogError("Failed to list keys", "error", appErr.Error())
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
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
		http.Error(w, "Message not found", http.StatusNotFound)
		return
	}

	var msg ScheduledMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		http.Error(w, "Invalid message data", http.StatusInternalServerError)
		return
	}

	if msg.UserID != req.UserID {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if appErr := p.API.KVDelete(req.ID); appErr != nil {
		http.Error(w, appErr.Error(), http.StatusInternalServerError)
		return
	}

	p.sendNotification(req.UserID, "❌ Scheduled message cancelled")

	json.NewEncoder(w).Encode(map[string]string{
		"status": "cancelled",
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
		p.API.LogError("Failed to send notification", 
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
			Text: "Error listing messages",
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
			Text: "No scheduled messages found.",
		}, nil
	}

	text := "### Your scheduled messages:\n"
	for _, msg := range messages {
		text += fmt.Sprintf("- `%s` at %s in ~%s: %s\n", 
			msg.ID[:8],
			msg.ScheduleTime.Format("2006-01-02 15:04"),
			msg.ChannelName,
			msg.Message)
	}

	return &model.CommandResponse{
		Text: text,
	}, nil
}

func (p *Plugin) cancelScheduledMessage(userID string, args []string) (*model.CommandResponse, *model.AppError) {
	if len(args) < 2 {
		return &model.CommandResponse{
			Text: "Usage: /schedule_cancel <message_id>",
		}, nil
	}

	msgID := args[1]
	data, appErr := p.API.KVGet(msgID)
	if appErr != nil || data == nil {
		return &model.CommandResponse{
			Text: "Message not found",
		}, nil
	}

	var msg ScheduledMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return &model.CommandResponse{
			Text: "Invalid message data",
		}, nil
	}

	if msg.UserID != userID {
		return &model.CommandResponse{
			Text: "Unauthorized",
		}, nil
	}

	p.API.KVDelete(msgID)
	p.sendNotification(userID, "❌ Scheduled message cancelled")

	return &model.CommandResponse{
		Text: "Message cancelled successfully",
	}, nil
}

func main() {
	plugin.ClientMain(&Plugin{})
}
