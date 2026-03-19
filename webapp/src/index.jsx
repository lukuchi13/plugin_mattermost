console.log('🔥 ПЛАГИН ПЛАНИРОВЩИКА ЗАГРУЖАЕТСЯ...');

class SchedulerPlugin {
    constructor() {
        this.initialized = false;
        this.initAttempts = 0;
        this.maxAttempts = 10;
        this.baseUrl = '/plugins/com.yourdomain.scheduler';
        this.modal = null;
        this.overlay = null;
        this.observer = null;
        this.buttonAdded = false;
        this.selectedFiles = []; // для хранения выбранных файлов
    }

    initialize(registry, store) {
        console.log('🚀 Инициализация плагина');
        this.registry = registry;
        this.store = store;
        this.initAttempts = 0;
        
        this.tryInit();
        this.setupObserver();
        this.setupTeamSwitchListener();
        this.setupKeyboardShortcuts();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+S для открытия планировщика
            if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                this.showScheduleModal();
            }
            // Escape для закрытия модалки
            if (e.key === 'Escape' && this.modal) {
                this.closeModal();
            }
        });
    }

    setupTeamSwitchListener() {
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                console.log('Смена команды/канала');
                setTimeout(() => {
                    this.buttonAdded = false;
                    this.addButtonToTextbox();
                }, 500);
            }
        }).observe(document, {subtree: true, childList: true});

        window.addEventListener('popstate', () => {
            console.log('Навигация');
            setTimeout(() => {
                this.buttonAdded = false;
                this.addButtonToTextbox();
            }, 500);
        });
    }

    setupObserver() {
        this.observer = new MutationObserver((mutations) => {
            if (!document.getElementById('scheduler-textbox-button') && this.initialized) {
                console.log('Кнопка пропала, восстанавливаем...');
                this.buttonAdded = false;
                this.addButtonToTextbox();
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }

    tryInit() {
        if (this.initialized && this.buttonAdded) return;
        
        this.initAttempts++;
        console.log(`Попытка инициализации ${this.initAttempts}...`);

        if (this.addButtonToTextbox()) {
            console.log('✅ Кнопка добавлена в поле ввода');
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
            console.log('Инициализация через реестр...');
            
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
                'Запланировать сообщение'
            );

            console.log('✅ Кнопка в заголовке канала добавлена');
            
        } catch (error) {
            console.error('Ошибка инициализации реестра:', error);
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
            'textarea[placeholder*="Напишите"]',
            'textarea[placeholder*="сообщение"]',
            '.form-control[placeholder*="сообщение"]'
        ];

        let textbox = null;
        for (const selector of textboxSelectors) {
            textbox = document.querySelector(selector);
            if (textbox) {
                console.log(`Найдено поле ввода: ${selector}`);
                break;
            }
        }

        if (!textbox) {
            console.log('Поле ввода не найдено');
            return false;
        }

        console.log('Добавление кнопки в поле ввода...');

        const button = document.createElement('button');
        button.id = 'scheduler-textbox-button';
        button.innerHTML = '📅';
        button.title = 'Запланировать сообщение';
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
            console.log('Кнопка планировщика нажата');
            
            const textbox = document.querySelector('#post_textbox, [data-testid="post_textbox"]');
            const currentText = textbox?.value || '';
            
            this.showScheduleModal(currentText);
        };

        const container = textbox.closest('.post-create__container') || 
                         textbox.closest('.AdvancedTextEditor') ||
                         textbox.closest('.form-group') ||
                         textbox.closest('.post-create-body') ||
                         textbox.closest('.row') ||
                         textbox.parentElement;

        if (container) {
            const style = window.getComputedStyle(container);
            if (style.position === 'static') {
                container.style.position = 'relative';
            }
            
            container.appendChild(button);
            console.log('✅ Кнопка добавлена');
            
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
            console.log('Получение ID текущего канала...');
            
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
                        console.log('✅ ID канала из URL:', channelRef);
                        return channelRef;
                    }
                }
            }

            return this.getChannelIdFromStore();
            
        } catch (error) {
            console.error('Ошибка получения ID канала:', error);
            return this.getChannelIdFromStore();
        }
    }

    getChannelIdFromStore() {
        try {
            const state = this.store?.getState?.();
            if (!state) return '';

            const channelId = state.entities?.channels?.currentChannelId;
            if (channelId) {
                console.log('✅ ID канала из store:', channelId);
                return channelId;
            }

            return '';
        } catch (error) {
            console.error('Ошибка получения канала из store:', error);
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
            return 'Текущий канал';
        } catch (error) {
            return 'Текущий канал';
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

    showScheduleModal(initialMessage = '') {
        console.log('Открытие окна планирования');
        
        if (this.modal) {
            this.closeModal();
        }

        const channelId = this.getCurrentChannelId();
        const channelName = this.getCurrentChannelName();
        const userId = this.getCurrentUserId();

        if (!channelId) {
            this.показатьУведомление('Не удалось определить текущий канал. Попробуйте ещё раз.', 'error');
            return;
        }

        if (!userId) {
            this.показатьУведомление('Не удалось определить пользователя. Обновите страницу.', 'error');
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
            width: 500px;
            max-width: 95%;
            color: #333;
            max-height: 90vh;
            overflow-y: auto;
        `;

        const now = new Date();
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
        const defaultDateTime = now.toISOString().slice(0, 16);

        this.modal.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #1E90FF;">📅 Запланировать сообщение</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                    Канал:
                </label>
                <div style="background: #f0f0f0; padding: 8px 12px; border-radius: 4px; color: #333; font-size: 14px;">
                    ${channelName}
                </div>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                    Дата и время:
                </label>
                <input 
                    type="datetime-local" 
                    id="schedule-datetime" 
                    value="${defaultDateTime}"
                    min="${new Date().toISOString().slice(0, 16)}"
                    style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;"
                >
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                    Сообщение:
                </label>
                <textarea 
                    id="schedule-message" 
                    placeholder="Введите текст сообщения..."
                    style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-height: 100px; resize: vertical;"
                >${initialMessage}</textarea>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                    Вложения:
                </label>
                <div style="border: 2px dashed #ddd; border-radius: 4px; padding: 15px; text-align: center; background: #fafafa;">
                    <input 
                        type="file" 
                        id="schedule-file" 
                        multiple
                        style="display: none;"
                    >
                    <button id="select-file-btn" style="
                        background: #f0f0f0;
                        border: 1px solid #ccc;
                        padding: 8px 15px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-bottom: 10px;
                    ">📎 Выбрать файлы</button>
                    <div id="selected-files" style="font-size: 12px; color: #666;"></div>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 20px;">
                <button id="schedule-cancel" style="
                    padding: 8px 16px;
                    background: #f5f5f5;
                    color: #666;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    cursor: pointer;
                ">Отмена</button>
                
                <button id="schedule-view-list" style="
                    padding: 8px 16px;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">📋 Мои сообщения</button>
                
                <button id="schedule-save" style="
                    padding: 8px 16px;
                    background: #1E90FF;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">📅 Запланировать</button>
            </div>
        `;

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.modal);

        // Обработчики для файлов
        const fileInput = document.getElementById('schedule-file');
        const selectBtn = document.getElementById('select-file-btn');
        const filesDiv = document.getElementById('selected-files');

        selectBtn.onclick = () => fileInput.click();

        fileInput.onchange = () => {
            this.selectedFiles = Array.from(fileInput.files);
            if (this.selectedFiles.length > 0) {
                filesDiv.innerHTML = this.selectedFiles.map(f => 
                    `📎 ${f.name} (${(f.size/1024).toFixed(1)} KB)`
                ).join('<br>');
            } else {
                filesDiv.innerHTML = '';
            }
        };

        document.getElementById('schedule-cancel').onclick = () => this.closeModal();
        
        document.getElementById('schedule-view-list').onclick = () => {
            this.closeModal();
            this.показатьСписокСообщений();
        };
        
        document.getElementById('schedule-save').onclick = () => {
            const datetime = document.getElementById('schedule-datetime').value;
            const message = document.getElementById('schedule-message').value;
            this.сохранитьСообщение(message, new Date(datetime));
        };
    }

    async сохранитьСообщение(message, scheduleTime) {
        if (!message.trim() && this.selectedFiles.length === 0) {
            this.показатьУведомление('Введите сообщение или выберите файл', 'error');
            return;
        }

        const now = new Date();
        if (scheduleTime <= now) {
            this.показатьУведомление('Выберите будущее время', 'error');
            return;
        }

        try {
            const channelId = this.getCurrentChannelId();
            const userId = this.getCurrentUserId();

            const saveBtn = document.getElementById('schedule-save');
            const originalText = saveBtn.textContent;
            saveBtn.textContent = '⏳ Отправка...';
            saveBtn.disabled = true;

            // Создаем FormData для отправки файлов
            const formData = new FormData();
            formData.append('user_id', userId);
            formData.append('channel_id', channelId);
            formData.append('message', message);
            formData.append('schedule_time', scheduleTime.toISOString());
            
            // Добавляем файлы
            this.selectedFiles.forEach((file, index) => {
                formData.append(`file${index}`, file);
            });

            const response = await fetch(`${this.baseUrl}/api/v1/schedule`, {
                method: 'POST',
                body: formData
                // Не устанавливаем Content-Type, браузер сам добавит с границей для FormData
            });

            if (response.ok) {
                const result = await response.json();
                this.показатьУведомление(
                    `✅ Запланировано на ${scheduleTime.toLocaleString()} в канале ${result.channel}`,
                    'success'
                );
                this.selectedFiles = []; // Очищаем выбранные файлы
                this.closeModal();
            } else {
                const error = await response.text();
                this.показатьУведомление(`❌ Ошибка: ${error}`, 'error');
            }
        } catch (error) {
            this.показатьУведомление(`❌ Ошибка сети: ${error.message}`, 'error');
        } finally {
            const saveBtn = document.getElementById('schedule-save');
            if (saveBtn) {
                saveBtn.textContent = '📅 Запланировать';
                saveBtn.disabled = false;
            }
        }
    }

    async показатьСписокСообщений() {
        const userId = this.getCurrentUserId();
        if (!userId) {
            this.показатьУведомление('Пользователь не найден', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/v1/list?user_id=${userId}`);
            const messages = await response.json();

            if (messages.length === 0) {
                this.показатьУведомление('Нет запланированных сообщений', 'info');
                return;
            }

            this.показатьМодалкуСписка(messages);
        } catch (error) {
            console.error('Ошибка загрузки сообщений:', error);
            this.показатьУведомление('Не удалось загрузить список сообщений', 'error');
        }
    }

    показатьМодалкуСписка(messages) {
        if (this.modal) this.closeModal();

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
            width: 600px;
            max-width: 95%;
            max-height: 80vh;
            overflow-y: auto;
            color: #333;
        `;

        const messagesHtml = messages.map(msg => {
            const date = new Date(msg.schedule_time);
            return `
                <div style="border: 1px solid #eee; margin-bottom: 10px; padding: 15px; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #1E90FF; font-weight: bold;">
                            📅 ${date.toLocaleString()}
                        </span>
                        <button onclick="window.отменитьСообщение('${msg.id}')" style="
                            background: #ff4444;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            padding: 5px 10px;
                            cursor: pointer;
                            font-size: 12px;
                        ">Отменить</button>
                    </div>
                    <div style="margin-top: 10px; padding: 10px; background: #f9f9f9; border-radius: 4px; color: #333;">
                        ${msg.message || '<i>без текста</i>'}
                    </div>
                    <div style="margin-top: 5px; font-size: 12px; color: #666;">
                        Канал: ~${msg.channel_name || 'неизвестный канал'}
                    </div>
                </div>
            `;
        }).join('');

        this.modal.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #1E90FF;">📋 Мои запланированные сообщения</h3>
            <div id="scheduled-messages-list">
                ${messagesHtml}
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
                <button id="close-list" style="
                    padding: 8px 16px;
                    background: #f5f5f5;
                    color: #666;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    cursor: pointer;
                ">Закрыть</button>
            </div>
        `;

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.modal);

        document.getElementById('close-list').onclick = () => this.closeModal();

        // Глобальная функция для отмены
        window.отменитьСообщение = async (id) => {
            await this.отменитьСообщение(id);
            this.closeModal();
            this.показатьСписокСообщений();
        };
    }

    async отменитьСообщение(id) {
        try {
            const userId = this.getCurrentUserId();
            const response = await fetch(`${this.baseUrl}/api/v1/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, user_id: userId })
            });

            if (response.ok) {
                this.показатьУведомление('✅ Сообщение отменено', 'success');
            } else {
                this.показатьУведомление('❌ Не удалось отменить сообщение', 'error');
            }
        } catch (error) {
            console.error('Ошибка отмены сообщения:', error);
            this.показатьУведомление('❌ Ошибка при отмене', 'error');
        }
    }

    показатьУведомление(текст, тип = 'info') {
        const уведомление = document.createElement('div');
        
        let цветФона = '#2196F3';
        if (тип === 'success') цветФона = '#4CAF50';
        if (тип === 'error') цветФона = '#f44336';
        if (тип === 'info') цветФона = '#2196F3';

        уведомление.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${цветФона};
            color: white;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10001;
            font-size: 14px;
            animation: слайдВправо 0.3s ease;
            max-width: 300px;
            word-wrap: break-word;
        `;

        // Добавляем анимации
        const style = document.createElement('style');
        style.textContent = `
            @keyframes слайдВправо {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes слайдВлево {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);

        уведомление.textContent = текст;
        document.body.appendChild(уведомление);

        setTimeout(() => {
            уведомление.style.animation = 'слайдВлево 0.3s ease';
            setTimeout(() => уведомление.remove(), 300);
        }, 3000);
    }

    closeModal() {
        if (this.modal?.parentNode) this.modal.parentNode.removeChild(this.modal);
        if (this.overlay?.parentNode) this.overlay.parentNode.removeChild(this.overlay);
        this.modal = null;
        this.overlay = null;
        this.selectedFiles = []; // Очищаем файлы при закрытии
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
