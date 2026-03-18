package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"mime/multipart"

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
	FileIDs      []string  `json:"file_ids"`
	FileNames    []string  `json:"file_names"`
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

		if !msg.IsSent && msg.ScheduleTime.Before(now) {
			p.API.LogInfo("Time to send message",
				"id", msg.ID,
				"channel", msg.ChannelID,
				"scheduled_time", msg.ScheduleTime.Format("2006-01-02 15:04:05"))

			success := p.sendScheduledMessage(msg)

			if success {
				msg.IsSent = true
				data, _ := json.Marshal(msg)
				p.API.KVSet(msg.ID, data)
				p.API.LogInfo("Message sent and marked as delivered", "id", msg.ID)
			} else {
				p.API.LogError("Failed to send message, will retry later", "id", msg.ID)
			}
		}
	}
}

func (p *Plugin) sendScheduledMessage(msg ScheduledMessage) bool {
	p.API.LogInfo("Attempting to send scheduled message",
		"id", msg.ID,
		"channel", msg.ChannelID,
		"user", msg.UserID,
		"files", len(msg.FileNames))

	channel, appErr := p.API.GetChannel(msg.ChannelID)
	if appErr != nil {
		p.API.LogError("Channel not found",
			"channel_id", msg.ChannelID,
			"error", appErr.Error())

		p.sendNotification(msg.UserID, fmt.Sprintf("❌ Cannot send scheduled message: channel not found\nMessage: %s", msg.Message))
		return false
	}

	user, appErr := p.API.GetUser(msg.UserID)
	if appErr != nil {
		p.API.LogError("User not found",
			"user_id", msg.UserID,
			"error", appErr.Error())
		return false
	}

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

	if len(msg.FileNames) > 0 {
		fileIDs := make([]string, 0)

		for i, fileName := range msg.FileNames {
			key := fmt.Sprintf("file_%s_%d", msg.ID, i)
			fileData, appErr := p.API.KVGet(key)
			if appErr != nil || fileData == nil {
				p.API.LogError("Failed to get file from KV", "key", key, "error", appErr)
				continue
			}

			uploadInfo, uploadErr := p.API.UploadFile(fileData, msg.ChannelID, fileName)
			if uploadErr != nil {
				p.API.LogError("Failed to upload file", "error", uploadErr.Error())
				continue
			}

			fileIDs = append(fileIDs, uploadInfo.Id)
			p.API.KVDelete(key)
		}

		if len(fileIDs) > 0 {
			post.FileIds = fileIDs
			p.API.LogInfo("Attached files to post", "count", len(fileIDs))
		}
	}

	createdPost, appErr := p.API.CreatePost(post)
	if appErr != nil {
		p.API.LogError("Failed to create post",
			"error", appErr.Error(),
			"channel", msg.ChannelID,
			"user", msg.UserID)

		p.sendNotification(msg.UserID, fmt.Sprintf("❌ Failed to send scheduled message: %s\nMessage: %s", appErr.Error(), msg.Message))
		return false
	}

	p.API.LogInfo("Scheduled message sent successfully",
		"id", msg.ID,
		"post_id", createdPost.Id,
		"channel", channel.Name)

	p.sendNotification(msg.UserID, fmt.Sprintf("✅ Your scheduled message has been sent to ~%s with %d file(s)!\n> %s",
		channel.DisplayName, len(msg.FileNames), msg.Message))

	return true
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
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

	contentType := r.Header.Get("Content-Type")

	if strings.HasPrefix(contentType, "multipart/form-data") {
		p.handleScheduleWithFiles(w, r)
	} else {
		p.handleScheduleJSON(w, r)
	}
}

func (p *Plugin) handleScheduleWithFiles(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		p.API.LogError("Failed to parse multipart form", "error", err.Error())
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	userID := r.FormValue("user_id")
	channelID := r.FormValue("channel_id")
	message := r.FormValue("message")
	scheduleTimeStr := r.FormValue("schedule_time")

	p.API.LogInfo("Received schedule request with files",
		"user_id", userID,
		"channel_id", channelID,
		"message_length", len(message),
		"schedule_time", scheduleTimeStr)

	if channelID == "" {
		http.Error(w, "Channel ID is required", http.StatusBadRequest)
		return
	}

	scheduleTime, err := time.Parse(time.RFC3339, scheduleTimeStr)
	if err != nil {
		p.API.LogError("Failed to parse schedule time", "error", err.Error())
		http.Error(w, "Invalid schedule time format", http.StatusBadRequest)
		return
	}

	if scheduleTime.Before(time.Now()) {
		http.Error(w, "Schedule time must be in future", http.StatusBadRequest)
		return
	}

	channel, appErr := p.API.GetChannel(channelID)
	if appErr != nil {
		p.API.LogError("Invalid channel", "channel_id", channelID, "error", appErr.Error())
		http.Error(w, fmt.Sprintf("Invalid channel: %v", appErr.Error()), http.StatusBadRequest)
		return
	}

	files := r.MultipartForm.File["files"]

	msg := ScheduledMessage{
		ID:           model.NewId(),
		UserID:       userID,
		ChannelID:    channelID,
		ChannelName:  channel.Name,
		Message:      message,
		ScheduleTime: scheduleTime,
		CreatedAt:    time.Now(),
		IsSent:       false,
		FileIDs:      make([]string, 0),
		FileNames:    make([]string, 0),
	}

	for _, fileHeader := range files {
		msg.FileNames = append(msg.FileNames, fileHeader.Filename)
	}

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

	if len(files) > 0 {
		if err := p.saveMessageFiles(msg.ID, files); err != nil {
			p.API.LogError("Failed to save files", "error", err.Error())
			p.API.KVDelete(msg.ID)
			http.Error(w, "Failed to save files", http.StatusInternalServerError)
			return
		}
	}

	p.API.LogInfo("Message scheduled successfully with files",
		"id", msg.ID,
		"user", userID,
		"channel", channelID,
		"files", len(files))

	p.sendNotification(userID, fmt.Sprintf("📅 Message scheduled for %s in ~%s with %d file(s)",
		scheduleTime.Format("2006-01-02 15:04"),
		channel.DisplayName,
		len(files)))

	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      msg.ID,
		"status":  "scheduled",
		"message": "Message scheduled successfully",
		"channel": channel.DisplayName,
		"time":    scheduleTime.Format("2006-01-02 15:04"),
		"files":   len(files),
	})
}

func (p *Plugin) handleScheduleJSON(w http.ResponseWriter, r *http.Request) {
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
	msg.FileIDs = []string{}
	msg.FileNames = []string{}

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

func (p *Plugin) saveMessageFiles(messageID string, fileHeaders []*multipart.FileHeader) error {
	for i, fileHeader := range fileHeaders {
		file, err := fileHeader.Open()
		if err != nil {
			return fmt.Errorf("failed to open file %s: %v", fileHeader.Filename, err)
		}
		defer file.Close()

		data, err := io.ReadAll(file)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %v", fileHeader.Filename, err)
		}

		key := fmt.Sprintf("file_%s_%d", messageID, i)
		if appErr := p.API.KVSet(key, data); appErr != nil {
			return fmt.Errorf("failed to save file %s to KV: %v", fileHeader.Filename, appErr)
		}
	}
	return nil
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

	for i := range msg.FileNames {
		key := fmt.Sprintf("file_%s_%d", req.ID, i)
		p.API.KVDelete(key)
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
		filesInfo := ""
		if len(msg.FileNames) > 0 {
			filesInfo = fmt.Sprintf(" [%d file(s)]", len(msg.FileNames))
		}
		text += fmt.Sprintf("- `%s` at %s in ~%s%s: %s\n",
			msg.ID[:8],
			msg.ScheduleTime.Format("2006-01-02 15:04"),
			msg.ChannelName,
			filesInfo,
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

	for i := range msg.FileNames {
		key := fmt.Sprintf("file_%s_%d", msgID, i)
		p.API.KVDelete(key)
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