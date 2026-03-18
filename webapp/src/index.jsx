console.log('🔥 SCHEDULER PLUGIN LOADING...');

let instance = null;

class SchedulerPlugin {
    constructor() {
        if (instance) {
            return instance;
        }
        
        console.log('Creating new plugin instance');
        this.initialized = false;
        this.initAttempts = 0;
        this.maxAttempts = 10;
        this.baseUrl = '/plugins/com.yourdomain.scheduler';
        this.modal = null;
        this.overlay = null;
        this.observer = null;
        this.buttonAdded = false;
        this.registryInitialized = false;
        this.listModal = null;
        this.currentChannelId = null;
        this.currentTeamId = null;
        
        instance = this;
    }

    initialize(registry, store) {
        if (this.registryInitialized) {
            return;
        }

        console.log('🚀 Plugin initialize called');
        this.registry = registry;
        this.store = store;
        this.initAttempts = 0;
        
        this.tryInit();
        this.setupObserver();
        this.setupTeamSwitchListener();
        
        this.registryInitialized = true;
    }

    setupTeamSwitchListener() {
        let lastUrl = location.href;
        let switchTimeout = null;
        
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                console.log('URL changed, clearing channel cache');
                
                this.currentChannelId = null;
                this.currentTeamId = null;
                
                if (switchTimeout) clearTimeout(switchTimeout);
                
                switchTimeout = setTimeout(() => {
                    this.buttonAdded = false;
                    this.addButtonToTextbox();
                }, 500);
            }
        }).observe(document, {subtree: true, childList: true});

        window.addEventListener('popstate', () => {
            this.currentChannelId = null;
            this.currentTeamId = null;
            
            if (switchTimeout) clearTimeout(switchTimeout);
            switchTimeout = setTimeout(() => {
                this.buttonAdded = false;
                this.addButtonToTextbox();
            }, 500);
        });
    }

    setupObserver() {
        if (this.observer) {
            this.observer.disconnect();
        }
        
        this.observer = new MutationObserver(() => {
            if (!document.getElementById('scheduler-textbox-button') && this.initialized) {
                this.buttonAdded = false;
                this.addButtonToTextbox();
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    tryInit() {
        if (this.initialized && this.buttonAdded) return;
        
        this.initAttempts++;
        console.log(`Attempt ${this.initAttempts} to initialize...`);

        if (this.addButtonToTextbox()) {
            console.log('✅ Button added to textbox');
            this.initialized = true;
            this.buttonAdded = true;
        }

        if (!this.registryInitialized && this.registry?.registerChannelHeaderButtonAction) {
            this.initViaRegistry();
        }

        if ((!this.initialized || !this.buttonAdded) && this.initAttempts < this.maxAttempts) {
            setTimeout(() => this.tryInit(), 1000);
        }
    }

    initViaRegistry() {
        try {
            const self = this;
            
            const icon = React.createElement('i', {
                className: 'fa fa-calendar',
                style: { color: '#1E90FF', fontSize: '18px', cursor: 'pointer' },
                key: 'scheduler-icon-' + Date.now()
            });

            this.registry.registerChannelHeaderButtonAction(
                icon,
                function() {
                    console.log('Registry button clicked');
                    if (self?.showScheduleModal) {
                        self.showScheduleModal();
                    } else if (instance?.showScheduleModal) {
                        instance.showScheduleModal();
                    }
                },
                'Schedule Message'
            );

            console.log('✅ Registry button added');
            
        } catch (error) {
            console.error('Registry initialization failed:', error);
        }
    }

    addButtonToTextbox() {
        if (document.getElementById('scheduler-textbox-button')) {
            return true;
        }

        const textboxSelectors = [
            '#post_textbox',
            '[data-testid="post_textbox"]',
            '.post-create__body textarea',
            '.AdvancedTextEditor textarea',
            'textarea[placeholder*="write"]',
            'textarea[placeholder*="message"]'
        ];

        let textbox = null;
        for (const selector of textboxSelectors) {
            textbox = document.querySelector(selector);
            if (textbox) break;
        }

        if (!textbox) return false;

        const button = document.createElement('button');
        button.id = 'scheduler-textbox-button';
        button.innerHTML = '📅';
        button.title = 'Schedule message';
        button.style.cssText = `
            position: absolute;
            right: 10px;
            bottom: 8px;
            z-index: 100;
            padding: 4px 8px;
            background: #1E90FF;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            transition: background-color 0.2s;
        `;

        button.onmouseover = () => { button.style.backgroundColor = '#0066CC'; };
        button.onmouseout = () => { button.style.backgroundColor = '#1E90FF'; };

        const self = this;
        button.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Textbox button clicked');
            if (self?.showScheduleModal) {
                self.showScheduleModal();
            } else if (instance?.showScheduleModal) {
                instance.showScheduleModal();
            }
        };

        const container = textbox.closest('.post-create__container') || 
                         textbox.closest('.AdvancedTextEditor') ||
                         textbox.closest('.form-group') ||
                         textbox.parentElement;

        if (container) {
            const style = window.getComputedStyle(container);
            if (style.position === 'static') {
                container.style.position = 'relative';
            }
            
            container.appendChild(button);
            
            if (!this.resizeObserver) {
                this.resizeObserver = new ResizeObserver(() => {
                    const btn = document.getElementById('scheduler-textbox-button');
                    if (btn) btn.style.bottom = '8px';
                });
                this.resizeObserver.observe(textbox);
            }
            
            return true;
        }

        return false;
    }

    getCurrentChannelId() {
        console.log('Getting current channel ID...');
        
        if (this.currentChannelId) {
            return this.currentChannelId;
        }

        try {
            const path = window.location.pathname;
            console.log('Current path:', path);
            
            const patterns = [
                /\/[^\/]+\/channels\/([a-z0-9_]+)/i,
                /\/channels\/([a-z0-9_]+)/i,
                /\/([a-z0-9_]{26,})/i
            ];
            
            for (const pattern of patterns) {
                const match = path.match(pattern);
                if (match && match[1]) {
                    const channelId = match[1];
                    console.log('Found channel reference:', channelId);
                    this.currentChannelId = channelId;
                    return channelId;
                }
            }
        } catch (error) {
            console.error('Error parsing URL:', error);
        }

        try {
            const channelElements = document.querySelectorAll('[data-channel-id]');
            for (const el of channelElements) {
                const channelId = el.getAttribute('data-channel-id');
                if (channelId) {
                    this.currentChannelId = channelId;
                    return channelId;
                }
            }
        } catch (error) {
            console.error('Error searching DOM:', error);
        }

        return null;
    }

    async getChannelDisplayName(channelId) {
        if (!channelId) return 'Unknown channel';
        
        try {
            if (channelId.includes('__')) {
                console.log('Direct message channel detected:', channelId);
                
                const [user1Id, user2Id] = channelId.split('__');
                
                const state = this.store?.getState?.();
                const users = state?.entities?.users?.profiles || {};
                
                const user1 = users[user1Id];
                const user2 = users[user2Id];
                
                if (user1 && user2) {
                    const currentUserId = this.getCurrentUserId();
                    const otherUser = user1Id === currentUserId ? user2 : user1;
                    
                    if (otherUser) {
                        const displayName = otherUser.nickname || otherUser.username || otherUser.first_name || otherUser.email;
                        return `💬 Direct message with ${displayName}`;
                    }
                }
                
                return '💬 Direct message';
            }
            
            const state = this.store?.getState?.();
            const channel = state?.entities?.channels?.channels?.[channelId];
            if (channel) {
                return channel.display_name || channel.name;
            }
            
            return 'Unknown channel';
        } catch (error) {
            console.error('Error getting channel name:', error);
            return 'Unknown channel';
        }
    }

    getCurrentUserId() {
        try {
            const state = this.store?.getState?.();
            return state?.entities?.users?.currentUserId || '';
        } catch (error) {
            return '';
        }
    }

    async showScheduleModal() {
        console.log('Opening schedule modal');
        
        if (this.modal) this.closeModal();

        const channelId = this.getCurrentChannelId();
        const channelName = await this.getChannelDisplayName(channelId);
        const userId = this.getCurrentUserId();

        console.log('Modal context:', { channelId, channelName, userId });

        if (!channelId) {
            alert('❌ Cannot identify current channel.\n\nPlease try:\n1. Switch to a different channel and back\n2. Refresh the page');
            return;
        }

        if (!userId) {
            alert('❌ Cannot identify user.\n\nPlease refresh the page.');
            return;
        }

        this.overlay = document.createElement('div');
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;

        this.modal = document.createElement('div');
        this.modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            width: 450px;
            max-width: 90%;
            color: #333;
        `;

        const now = new Date();
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
        const defaultDateTime = now.toISOString().slice(0, 16);

        const self = this;

        this.modal.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #1E90FF;">📅 Schedule Message</h3>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #555;">
                    Channel:
                </label>
                <div style="background: #f0f0f0; padding: 10px; border-radius: 4px; color: #333;">
                    ${channelName}
                </div>
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #555;">
                    Date and Time:
                </label>
                <input 
                    type="datetime-local" 
                    id="schedule-datetime" 
                    value="${defaultDateTime}"
                    min="${new Date().toISOString().slice(0, 16)}"
                    style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                >
            </div>

            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: bold; color: #555;">
                    Message:
                </label>
                <textarea 
                    id="schedule-message" 
                    placeholder="Enter your message..."
                    style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-height: 120px; resize: vertical;"
                ></textarea>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 20px;">
                <button id="schedule-cancel" style="
                    padding: 10px 20px;
                    background: #f5f5f5;
                    color: #666;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    cursor: pointer;
                ">Cancel</button>
                
                <button id="schedule-view-list" style="
                    padding: 10px 20px;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">📋 My Schedule</button>
                
                <button id="schedule-save" style="
                    padding: 10px 20px;
                    background: #1E90FF;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">Schedule</button>
            </div>
        `;

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.modal);

        document.getElementById('schedule-cancel').onclick = () => self.closeModal();
        
        // Исправляем обработчик для кнопки My Schedule
        document.getElementById('schedule-view-list').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('My Schedule button clicked in modal');
            
            // Сначала закрываем модальное окно
            self.closeModal();
            
            // Небольшая задержка для гарантии закрытия
            setTimeout(() => {
                // Вызываем showScheduledList через правильный контекст
                if (self && typeof self.showScheduledList === 'function') {
                    self.showScheduledList();
                } else if (instance && typeof instance.showScheduledList === 'function') {
                    instance.showScheduledList();
                } else {
                    console.error('showScheduledList not available');
                }
            }, 100);
        };
        
        document.getElementById('schedule-save').onclick = () => {
            const datetime = document.getElementById('schedule-datetime').value;
            const message = document.getElementById('schedule-message').value;
            if (datetime && message.trim()) {
                self.saveScheduledMessage(message, new Date(datetime));
            } else {
                alert('Please fill all fields');
            }
        };
    }

    async saveScheduledMessage(message, scheduleTime) {
        try {
            const channelId = this.getCurrentChannelId();
            const userId = this.getCurrentUserId();

            if (!channelId || !userId) {
                alert('Cannot identify channel or user. Please refresh and try again.');
                return;
            }

            console.log('Saving message:', { channelId, userId, message, scheduleTime });

            const response = await fetch(`${this.baseUrl}/api/v1/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    channel_id: channelId,
                    message: message,
                    schedule_time: scheduleTime.toISOString()
                })
            });

            if (response.ok) {
                alert(`✅ Message scheduled for ${scheduleTime.toLocaleString()}`);
                this.closeModal();
            } else {
                const error = await response.text();
                alert(`❌ Failed: ${error}`);
            }
        } catch (error) {
            alert(`❌ Error: ${error.message}`);
        }
    }

    async showScheduledList() {
        console.log('Opening scheduled list');
        
        const userId = this.getCurrentUserId();
        if (!userId) {
            alert('Cannot identify user');
            return;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/v1/list?user_id=${userId}`);
            const messages = await response.json();

            if (messages.length === 0) {
                alert('📭 No scheduled messages found');
                return;
            }

            if (this.listModal) {
                document.body.removeChild(this.listModal);
                this.listModal = null;
            }

            this.listModal = document.createElement('div');
            this.listModal.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 25px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 10000;
                width: 500px;
                max-width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                color: #333;
            `;

            let messagesHtml = '';
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                const scheduleTime = new Date(msg.schedule_time);
                const timeStr = scheduleTime.toLocaleString();
                const shortId = msg.id.substring(0, 8);
                
                let channelDisplay = msg.channel_name || 'Unknown';
                if (msg.channel_id && msg.channel_id.includes('__')) {
                    const channelName = await this.getChannelDisplayName(msg.channel_id);
                    channelDisplay = channelName;
                }
                
                messagesHtml += `
                    <div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 15px; margin-bottom: 15px; background: #fafafa;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <span style="background: #1E90FF; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                                #${i + 1}
                            </span>
                            <span style="color: #666; font-size: 12px;">
                                ID: ${shortId}
                            </span>
                        </div>
                        
                        <div style="margin-bottom: 10px;">
                            <div style="font-weight: bold; color: #1E90FF; margin-bottom: 5px;">
                                🕐 ${timeStr}
                            </div>
                            <div style="background: white; padding: 10px; border-radius: 4px; border-left: 3px solid #1E90FF;">
                                ${msg.message}
                            </div>
                        </div>
                        
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888;">
                            <span>📢 ${channelDisplay}</span>
                            <button class="cancel-schedule-btn" data-id="${msg.id}" style="
                                background: #ff4444;
                                color: white;
                                border: none;
                                border-radius: 4px;
                                padding: 5px 10px;
                                cursor: pointer;
                                font-size: 12px;
                            ">❌ Cancel</button>
                        </div>
                    </div>
                `;
            }

            this.listModal.innerHTML = `
                <h3 style="margin: 0 0 20px 0; color: #1E90FF; display: flex; align-items: center; gap: 10px;">
                    <span>📋 Scheduled Messages</span>
                    <span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 14px;">
                        ${messages.length}
                    </span>
                </h3>
                
                <div style="margin-bottom: 20px;">
                    ${messagesHtml}
                </div>
                
                <div style="display: flex; justify-content: flex-end; border-top: 1px solid #eee; padding-top: 20px;">
                    <button id="close-list-modal" style="
                        padding: 10px 20px;
                        background: #f5f5f5;
                        color: #666;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Close</button>
                </div>
            `;

            document.body.appendChild(this.listModal);

            const self = this;
            document.querySelectorAll('.cancel-schedule-btn').forEach(btn => {
                btn.onclick = async function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = this.dataset.id;
                    if (confirm('Are you sure you want to cancel this scheduled message?')) {
                        await self.cancelScheduledMessage(id);
                        if (self.listModal && self.listModal.parentNode) {
                            document.body.removeChild(self.listModal);
                            self.listModal = null;
                        }
                        setTimeout(() => self.showScheduledList(), 500);
                    }
                };
            });

            document.getElementById('close-list-modal').onclick = () => {
                if (self.listModal && self.listModal.parentNode) {
                    document.body.removeChild(self.listModal);
                    self.listModal = null;
                }
            };

        } catch (error) {
            console.error('Error loading scheduled messages:', error);
            alert('Error loading scheduled messages');
        }
    }

    async cancelScheduledMessage(id) {
        try {
            const response = await fetch(`${this.baseUrl}/api/v1/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: id,
                    user_id: this.getCurrentUserId()
                })
            });

            if (response.ok) {
                alert('✅ Message cancelled successfully');
            } else {
                alert('❌ Failed to cancel message');
            }
        } catch (error) {
            console.error('Error cancelling message:', error);
            alert('Error cancelling message');
        }
    }

    closeModal() {
        if (this.modal?.parentNode) {
            this.modal.parentNode.removeChild(this.modal);
            this.modal = null;
        }
        if (this.overlay?.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
            this.overlay = null;
        }
    }
}

const pluginInstance = new SchedulerPlugin();

if (typeof window !== 'undefined' && !window.__SCHEDULER_PLUGIN_INSTANCE) {
    console.log('Registering plugin...');
    
    window.__SCHEDULER_PLUGIN_INSTANCE = pluginInstance;
    
    if (window.registerPlugin) {
        window.registerPlugin('com.yourdomain.scheduler', pluginInstance);
    }
    
    window.plugins = window.plugins || {};
    window.plugins['com.yourdomain.scheduler'] = pluginInstance;
    
    window.com = window.com || {};
    window.com.yourdomain = window.com.yourdomain || {};
    window.com.yourdomain.scheduler = pluginInstance;
    
    console.log('✅ Plugin registered');
}

setTimeout(() => {
    if (!pluginInstance.initialized) {
        const registry = window.mattermost_webapp?.registry;
        const store = window.store;
        if (registry && store) {
            pluginInstance.initialize(registry, store);
        } else {
            pluginInstance.tryInit();
        }
    }
}, 2000);

export default pluginInstance;
