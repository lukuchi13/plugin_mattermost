console.log('🔥 SCHEDULER PLUGIN LOADING...');

class SchedulerPlugin {
    constructor() {
        this.initialized = false;
        this.initAttempts = 0;
        this.maxAttempts = 10;
        this.baseUrl = '/plugins/com.yourdomain.scheduler';
        this.modal = null;
        this.overlay = null;
        this.observer = null; // Для MutationObserver
        this.buttonAdded = false;
    }

    initialize(registry, store) {
        console.log('🚀 Plugin initialize called');
        this.registry = registry;
        this.store = store;
        this.initAttempts = 0;
        
        // Запускаем основной метод инициализации
        this.tryInit();
        
        // Устанавливаем наблюдатель за изменениями DOM
        this.setupObserver();
        
        // Слушаем события переключения команды
        this.setupTeamSwitchListener();
    }

    setupTeamSwitchListener() {
        // Наблюдаем за изменением URL (переключение команд)
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                console.log('URL changed, team might have switched');
                // Даем время на перерисовку DOM
                setTimeout(() => {
                    this.buttonAdded = false;
                    this.addButtonToTextbox();
                }, 500);
            }
        }).observe(document, {subtree: true, childList: true});

        // Также слушаем popstate для истории браузера
        window.addEventListener('popstate', () => {
            console.log('Navigation detected');
            setTimeout(() => {
                this.buttonAdded = false;
                this.addButtonToTextbox();
            }, 500);
        });
    }

    setupObserver() {
        // MutationObserver для отслеживания изменений в DOM
        this.observer = new MutationObserver((mutations) => {
            // Проверяем, не пропала ли наша кнопка
            if (!document.getElementById('scheduler-textbox-button') && this.initialized) {
                console.log('Button disappeared, readding...');
                this.buttonAdded = false;
                this.addButtonToTextbox();
            }
        });

        // Наблюдаем за всем body на предмет изменений
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
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

        if (this.registry && this.registry.registerChannelHeaderButtonAction) {
            this.initViaRegistry();
        }

        if ((!this.initialized || !this.buttonAdded) && this.initAttempts < this.maxAttempts) {
            setTimeout(() => this.tryInit(), 1000);
        }
    }

    initViaRegistry() {
        try {
            console.log('Initializing via registry...');
            
            const icon = React.createElement('i', {
                className: 'fa fa-calendar',
                style: { 
                    color: '#1E90FF', 
                    fontSize: '18px',
                    cursor: 'pointer'
                }
            });

            this.registry.registerChannelHeaderButtonAction(
                icon,
                () => this.showScheduleModal(),
                'Schedule Message'
            );

            console.log('✅ Registry button added');
            
        } catch (error) {
            console.error('Registry initialization failed:', error);
        }
    }

    addButtonToTextbox() {
        // Если кнопка уже есть, не добавляем повторно
        if (document.getElementById('scheduler-textbox-button')) {
            return true;
        }

        const textboxSelectors = [
            '#post_textbox',
            '[data-testid="post_textbox"]',
            '.post-create__body textarea',
            '.AdvancedTextEditor textarea',
            'textarea[placeholder*="write"]',
            'textarea[placeholder*="message"]',
            '.form-control[placeholder*="message"]'
        ];

        let textbox = null;
        for (const selector of textboxSelectors) {
            textbox = document.querySelector(selector);
            if (textbox) {
                console.log(`Found textbox with selector: ${selector}`);
                break;
            }
        }

        if (!textbox) {
            console.log('Textbox not found');
            return false;
        }

        console.log('Adding button to textbox...');

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

        button.onmouseover = () => {
            button.style.backgroundColor = '#0066CC';
        };
        button.onmouseout = () => {
            button.style.backgroundColor = '#1E90FF';
        };

        button.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Schedule button clicked');
            this.showScheduleModal();
        };

        // Пробуем найти контейнер несколькими способами
        const container = textbox.closest('.post-create__container') || 
                         textbox.closest('.AdvancedTextEditor') ||
                         textbox.closest('.form-group') ||
                         textbox.closest('.post-create-body') ||
                         textbox.closest('.row') ||
                         textbox.parentElement;

        if (container) {
            // Убеждаемся что контейнер имеет position relative
            const style = window.getComputedStyle(container);
            if (style.position === 'static') {
                container.style.position = 'relative';
            }
            
            container.appendChild(button);
            console.log('✅ Button added to textbox container');
            
            // Добавляем обработчик изменения размера
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
        try {
            console.log('Getting current channel ID...');
            
            // Способ 1: Из URL
            const path = window.location.pathname;
            
            const channelMatches = [
                path.match(/\/channels\/([a-z0-9]+)$/i),
                path.match(/\/channels\/([^\/]+)$/),
                path.match(/\/([a-z0-9]{26})$/i)
            ];
            
            for (const match of channelMatches) {
                if (match && match[1]) {
                    const channelRef = match[1];
                    if (channelRef.length === 26) {
                        console.log('✅ Valid channel ID from URL:', channelRef);
                        return channelRef;
                    }
                }
            }

            return this.getChannelIdFromStore();
            
        } catch (error) {
            console.error('Error in getCurrentChannelId:', error);
            return this.getChannelIdFromStore();
        }
    }

    getChannelIdFromStore() {
        try {
            const state = this.store?.getState?.();
            if (!state) return '';

            const channelId = state.entities?.channels?.currentChannelId;
            if (channelId) {
                console.log('✅ Found channel ID in store:', channelId);
                return channelId;
            }

            return '';
        } catch (error) {
            console.error('Error getting channel from store:', error);
            return '';
        }
    }

    getCurrentChannelName() {
        try {
            const state = this.store?.getState?.();
            const channelId = this.getCurrentChannelId();
            
            if (state?.entities?.channels?.channels && channelId) {
                const channel = state.entities.channels.channels[channelId];
                if (channel) {
                    return channel.display_name || channel.name;
                }
            }
            return 'Current channel';
        } catch (error) {
            return 'Current channel';
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

    showScheduleModal() {
        console.log('Opening schedule modal');
        
        if (this.modal) {
            this.closeModal();
        }

        const channelId = this.getCurrentChannelId();
        const channelName = this.getCurrentChannelName();
        const userId = this.getCurrentUserId();

        if (!channelId) {
            alert('Cannot identify current channel. Please try again.');
            return;
        }

        if (!userId) {
            alert('Cannot identify user. Please refresh the page.');
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
                ">My Schedule</button>
                
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

        document.getElementById('schedule-cancel').onclick = () => this.closeModal();
        document.getElementById('schedule-view-list').onclick = () => {
            this.closeModal();
            this.showScheduledList();
        };
        document.getElementById('schedule-save').onclick = () => {
            const datetime = document.getElementById('schedule-datetime').value;
            const message = document.getElementById('schedule-message').value;
            this.saveScheduledMessage(message, new Date(datetime));
        };
    }

    async saveScheduledMessage(message, scheduleTime) {
        try {
            const channelId = this.getCurrentChannelId();
            const userId = this.getCurrentUserId();

            const response = await fetch(`${this.baseUrl}/api/v1/schedule`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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
        const userId = this.getCurrentUserId();
        if (!userId) return;

        try {
            const response = await fetch(`${this.baseUrl}/api/v1/list?user_id=${userId}`);
            const messages = await response.json();

            if (messages.length === 0) {
                alert('No scheduled messages');
                return;
            }

            // ... (код отображения списка)
        } catch (error) {
            console.error('Error:', error);
        }
    }

    closeModal() {
        if (this.modal?.parentNode) this.modal.parentNode.removeChild(this.modal);
        if (this.overlay?.parentNode) this.overlay.parentNode.removeChild(this.overlay);
        this.modal = null;
        this.overlay = null;
    }
}

const pluginInstance = new SchedulerPlugin();

if (typeof window !== 'undefined') {
    if (window.registerPlugin) {
        window.registerPlugin('com.yourdomain.scheduler', pluginInstance);
    }
    window.plugins = window.plugins || {};
    window.plugins['com.yourdomain.scheduler'] = pluginInstance;
    window.com = window.com || {};
    window.com.yourdomain = window.com.yourdomain || {};
    window.com.yourdomain.scheduler = pluginInstance;
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
