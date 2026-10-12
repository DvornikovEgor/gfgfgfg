import { useState, useEffect, useRef, useCallback } from 'react';
import { getOfflineResponse } from './utils/botBrain';
import { parseMarkdown } from './utils/markdownParser';

// ===== Типы =====
interface Message {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: number;
}

interface Settings {
  apiUrl: string;
  apiKey: string;
  model: string;
}

// ===== Константы =====
const MAX_INPUT_LENGTH = 2000;
const MAX_HISTORY_FOR_API = 20;
const SYSTEM_PROMPT = 'Ты — дружелюбный ассистент, отвечай кратко и по делу на языке пользователя.';
const WELCOME_MESSAGE = 'Привет! 👋 Я — НейроЧат, твой умный ассистент. Могу поболтать, рассказать шутку, помочь с математикой или подключиться к настоящему ИИ через API. Напиши что-нибудь!';

const QUICK_BUTTONS = ['Расскажи шутку', 'Какая погода?', 'Помощь', 'Который час?'];

// ===== Утилиты =====
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.warn('Ошибка загрузки из localStorage:', e);
  }
  return defaultValue;
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Ошибка сохранения в localStorage:', e);
  }
}

// ===== Основной компонент =====
export default function App() {
  // Состояния
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isDark, setIsDark] = useState(() => loadFromStorage('chat-theme', false));
  const [mode, setMode] = useState<'offline' | 'api'>('offline');
  const [settings, setSettings] = useState<Settings>(() =>
    loadFromStorage('chat-settings', { apiUrl: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-3.5-turbo' })
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sessionStart] = useState(Date.now());
  const [showQuickButtons, setShowQuickButtons] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Рефы
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ===== Инициализация =====
  useEffect(() => {
    const savedMessages = loadFromStorage<Message[]>('chat-messages', []);
    if (savedMessages.length > 0) {
      setMessages(savedMessages);
      setShowQuickButtons(false);
    } else {
      setMessages([{
        id: generateId(),
        role: 'bot',
        content: WELCOME_MESSAGE,
        timestamp: Date.now()
      }]);
    }
  }, []);

  // Сохранение сообщений
  useEffect(() => {
    if (messages.length > 0) {
      saveToStorage('chat-messages', messages);
    }
  }, [messages]);

  // Сохранение темы
  useEffect(() => {
    saveToStorage('chat-theme', isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Сохранение настроек
  useEffect(() => {
    saveToStorage('chat-settings', settings);
  }, [settings]);

  // Автоскролл
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isTyping]);

  // Авторасширение textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 132; // ~5 строк
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
      textareaRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [input]);

  // ===== Обработчики =====

  // Отправка сообщения
  const sendMessage = useCallback(async (text?: string) => {
    const messageText = (text || input).trim();
    if (!messageText || isTyping || isStreaming) return;

    // Убираем быстрые кнопки после первого сообщения
    if (showQuickButtons) setShowQuickButtons(false);

    // Добавляем сообщение пользователя
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: messageText,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // Получаем ответ
    setIsTyping(true);

    if (mode === 'offline') {
      // Офлайн-режим: небольшая задержка для реалистичности
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      const response = getOfflineResponse(messageText);
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: generateId(),
        role: 'bot',
        content: response,
        timestamp: Date.now()
      }]);
    } else {
      // API-режим
      if (!settings.apiKey) {
        setIsTyping(false);
        setMessages(prev => [...prev, {
          id: generateId(),
          role: 'bot',
          content: '⚠️ API-ключ не указан. Открой настройки (⚙️) и введи ключ, или переключись в офлайн-режим.',
          timestamp: Date.now()
        }]);
        return;
      }

      try {
        // Формируем историю для API
        const recentMessages = [...messages, userMsg]
          .slice(-MAX_HISTORY_FOR_API)
          .map(m => ({
            role: m.role === 'bot' ? 'assistant' : 'user',
            content: m.content
          }));

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const response = await fetch(settings.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...recentMessages
            ],
            stream: true
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errorData = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorData}`);
        }

        setIsTyping(false);
        setIsStreaming(true);
        setStreamingContent('');

        // Обрабатываем SSE-стриминг
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    fullContent += delta;
                    setStreamingContent(fullContent);
                  }
                } catch {
                  // Пропускаем не-JSON строки
                }
              }
            }
          }
        }

        setIsStreaming(false);
        setStreamingContent('');
        setMessages(prev => [...prev, {
          id: generateId(),
          role: 'bot',
          content: fullContent || 'Пустой ответ от API.',
          timestamp: Date.now()
        }]);
      } catch (error: unknown) {
        setIsTyping(false);
        setIsStreaming(false);
        setStreamingContent('');
        
        const errMsg = error instanceof Error ? error.message : 'Неизвестная ошибка';
        const isAbort = error instanceof Error && error.name === 'AbortError';
        
        if (!isAbort) {
          setMessages(prev => [...prev, {
            id: generateId(),
            role: 'bot',
            content: `⚠️ Ошибка API: ${errMsg}\n\nПопробуй проверить настройки или переключиться в офлайн-режим.`,
            timestamp: Date.now()
          }]);
        }
      }
    }
  }, [input, isTyping, isStreaming, mode, settings, messages, showQuickButtons]);

  // Обработка клавиш
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Очистка чата
  const clearChat = () => {
    const welcomeMsg: Message = {
      id: generateId(),
      role: 'bot',
      content: WELCOME_MESSAGE,
      timestamp: Date.now()
    };
    setMessages([welcomeMsg]);
    setShowQuickButtons(true);
    setShowClearConfirm(false);
    localStorage.removeItem('chat-messages');
    showToast('Чат очищен');
  };

  // Копирование текста
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Скопировано');
    }).catch(() => {
      showToast('Не удалось скопировать');
    });
  };

  // Экспорт переписки
  const exportChat = () => {
    const text = messages.map(m => {
      const time = new Date(m.timestamp).toLocaleString('ru-RU');
      const role = m.role === 'user' ? 'Вы' : 'НейроЧат';
      return `[${time}] ${role}:\n${m.content}\n`;
    }).join('\n---\n\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Переписка экспортирована');
  };

  // Тост-уведомление
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  // Время сессии
  const getSessionTime = () => {
    const diff = Math.floor((Date.now() - sessionStart) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    if (mins > 0) return `${mins} мин ${secs} с`;
    return `${secs} с`;
  };

  const [sessionTime, setSessionTime] = useState(getSessionTime());
  useEffect(() => {
    const interval = setInterval(() => setSessionTime(getSessionTime()), 1000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  // ===== Рендер =====
  const themeClass = isDark ? 'dark' : '';

  return (
    <div className={`${themeClass} min-h-screen flex items-center justify-center p-2 sm:p-4 transition-colors duration-300`}>
      <div className={`w-full max-w-2xl h-[100dvh] sm:h-[90vh] max-h-[800px] flex flex-col rounded-2xl shadow-2xl overflow-hidden transition-colors duration-300 ${
        isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'
      }`}>
        
        {/* ===== Шапка ===== */}
        <header className={`flex items-center justify-between px-4 py-3 border-b ${
          isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full gradient-accent flex items-center justify-center text-white text-lg">
              🤖
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">НейроЧат</h1>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>онлайн</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {/* Переключатель режима */}
            <button
              onClick={() => setMode(mode === 'offline' ? 'api' : 'offline')}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                mode === 'api'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
              }`}
              title={mode === 'offline' ? 'Переключить на API' : 'Переключить в офлайн'}
            >
              {mode === 'api' ? '🌐 API' : '📴 Офлайн'}
            </button>
            
            {/* Переключатель темы */}
            <button
              onClick={() => setIsDark(!isDark)}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? 'hover:bg-gray-700 text-yellow-400' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title="Переключить тему"
            >
              {isDark ? '☀️' : '🌙'}
            </button>
            
            {/* Настройки */}
            <button
              onClick={() => setShowSettings(true)}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'
              }`}
              title="Настройки"
            >
              ⚙️
            </button>
          </div>
        </header>

        {/* ===== Область сообщений ===== */}
        <div className="flex-1 overflow-y-auto chat-scroll px-4 py-4 space-y-3">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isDark={isDark}
              onCopy={copyToClipboard}
            />
          ))}
          
          {/* Стриминг-сообщение */}
          {isStreaming && streamingContent && (
            <div className="flex justify-start animate-message-in">
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                isDark ? 'bg-gray-800 text-gray-100' : 'bg-gray-100 text-gray-900'
              }`}>
                <div className="msg-markdown text-[15px] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(streamingContent) }}
                />
              </div>
            </div>
          )}
          
          {/* Индикатор печати */}
          {isTyping && !isStreaming && (
            <div className="flex justify-start animate-message-in">
              <div className={`rounded-2xl px-4 py-3 ${
                isDark ? 'bg-gray-800' : 'bg-gray-100'
              }`}>
                <div className="flex items-center gap-1">
                  <span className="typing-dot w-2 h-2 rounded-full bg-purple-500 inline-block"></span>
                  <span className="typing-dot w-2 h-2 rounded-full bg-purple-500 inline-block"></span>
                  <span className="typing-dot w-2 h-2 rounded-full bg-purple-500 inline-block"></span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>

        {/* ===== Быстрые кнопки ===== */}
        {showQuickButtons && (
          <div className="px-4 pb-2 flex flex-wrap gap-2 animate-fade-in">
            {QUICK_BUTTONS.map((btn) => (
              <button
                key={btn}
                onClick={() => sendMessage(btn)}
                className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                  isDark
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {btn}
              </button>
            ))}
          </div>
        )}

        {/* ===== Поле ввода ===== */}
        <div className={`px-4 pt-2 pb-2 border-t ${
          isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50/50'
        }`}>
          <div className={`flex items-end gap-2 rounded-xl p-2 ${
            isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200 shadow-sm'
          }`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                if (e.target.value.length <= MAX_INPUT_LENGTH) {
                  setInput(e.target.value);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Напишите сообщение..."
              rows={1}
              className={`chat-textarea flex-1 bg-transparent outline-none text-[15px] leading-relaxed placeholder-gray-400 ${
                isDark ? 'text-gray-100' : 'text-gray-900'
              }`}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isTyping || isStreaming}
              className={`p-2.5 rounded-xl transition-all ${
                input.trim() && !isTyping && !isStreaming
                  ? 'gradient-accent text-white shadow-md hover:shadow-lg hover:scale-105'
                  : isDark ? 'bg-gray-700 text-gray-500' : 'bg-gray-200 text-gray-400'
              }`}
              title="Отправить"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
          
          {/* Счётчик символов */}
          <div className="flex justify-between items-center mt-1 px-1">
            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Enter — отправить, Shift+Enter — перенос
            </span>
            <span className={`text-xs ${
              input.length > MAX_INPUT_LENGTH * 0.9
                ? 'text-red-500'
                : isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              {input.length}/{MAX_INPUT_LENGTH}
            </span>
          </div>
        </div>

        {/* ===== Футер ===== */}
        <div className={`flex items-center justify-between px-4 py-2 text-xs border-t ${
          isDark ? 'border-gray-700 text-gray-500 bg-gray-800/30' : 'border-gray-100 text-gray-400 bg-gray-50/30'
        }`}>
          <div className="flex items-center gap-3">
            <span>💬 {messages.length} сообщ.</span>
            <span>⏱️ {sessionTime}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportChat}
              className="hover:opacity-70 transition-opacity"
              title="Экспорт переписки"
            >
              📥 Экспорт
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="hover:opacity-70 transition-opacity text-red-400"
              title="Очистить чат"
            >
              🗑️ Очистить
            </button>
          </div>
        </div>
      </div>

      {/* ===== Модальное окно настроек ===== */}
      {showSettings && (
        <Modal isDark={isDark} onClose={() => setShowSettings(false)}>
          <h2 className="text-lg font-semibold mb-4">⚙️ Настройки API</h2>
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                URL эндпоинта
              </label>
              <input
                type="url"
                value={settings.apiUrl}
                onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
                placeholder="https://api.openai.com/v1/chat/completions"
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${
                  isDark
                    ? 'bg-gray-800 border-gray-600 text-gray-100 focus:border-purple-500'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-purple-500'
                }`}
              />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                API-ключ
              </label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                placeholder="sk-..."
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${
                  isDark
                    ? 'bg-gray-800 border-gray-600 text-gray-100 focus:border-purple-500'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-purple-500'
                }`}
              />
              <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                🔒 Ключ хранится только в вашем браузере
              </p>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Модель
              </label>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                placeholder="gpt-3.5-turbo"
                className={`w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${
                  isDark
                    ? 'bg-gray-800 border-gray-600 text-gray-100 focus:border-purple-500'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-purple-500'
                }`}
              />
            </div>
            <button
              onClick={() => { setShowSettings(false); showToast('Настройки сохранены'); }}
              className="w-full py-2.5 rounded-xl gradient-accent text-white font-medium hover:opacity-90 transition-opacity"
            >
              Сохранить
            </button>
          </div>
        </Modal>
      )}

      {/* ===== Модальное окно подтверждения очистки ===== */}
      {showClearConfirm && (
        <Modal isDark={isDark} onClose={() => setShowClearConfirm(false)}>
          <h2 className="text-lg font-semibold mb-2">🗑️ Очистить чат?</h2>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Вся история переписки будет удалена. Это действие нельзя отменить.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowClearConfirm(false)}
              className={`flex-1 py-2.5 rounded-xl font-medium transition-colors ${
                isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Отмена
            </button>
            <button
              onClick={clearChat}
              className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors"
            >
              Очистить
            </button>
          </div>
        </Modal>
      )}

      {/* ===== Тост-уведомление ===== */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-toast-in">
          <div className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
            isDark ? 'bg-gray-800 text-gray-100 border border-gray-700' : 'bg-white text-gray-900 border border-gray-200'
          }`}>
            ✅ {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Компонент пузыря сообщения =====
function MessageBubble({ message, isDark, onCopy }: {
  message: Message;
  isDark: boolean;
  onCopy: (text: string) => void;
}) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-message-in`}>
      <div className={`max-w-[85%] group relative`}>
        <div className={`rounded-2xl px-4 py-3 ${
          isUser
            ? 'gradient-accent text-white rounded-br-md'
            : isDark
              ? 'bg-gray-800 text-gray-100 rounded-bl-md'
              : 'bg-gray-100 text-gray-900 rounded-bl-md'
        }`}>
          {isUser ? (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div
              className="msg-markdown text-[15px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: parseMarkdown(message.content) }}
            />
          )}
        </div>
        
        {/* Кнопка копирования для сообщений бота */}
        {!isUser && (
          <button
            onClick={() => onCopy(message.content)}
            className={`absolute -bottom-6 left-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-0.5 rounded ${
              isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
            }`}
            title="Копировать"
          >
            📋 Копировать
          </button>
        )}
        
        {/* Время */}
        <div className={`text-[10px] mt-1 ${isUser ? 'text-right' : 'text-left'} ${
          isDark ? 'text-gray-600' : 'text-gray-400'
        }`}>
          {new Date(message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// ===== Модальное окно =====
function Modal({ children, isDark, onClose }: {
  children: React.ReactNode;
  isDark: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl animate-slide-up ${
          isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
