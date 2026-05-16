import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './components';
import { OpenVikingBlogArticle } from './zoukEmbed/OpenVikingBlogArticle';

const DEFAULT_SERVER_URL = import.meta.env.VITE_ZOUK_SERVER_URL || 'https://zouk.zaynjarvis.com';
const DEFAULT_WORKSPACE_ID = import.meta.env.VITE_ZOUK_WORKSPACE_ID || 'default';
const DEFAULT_CHANNEL = (import.meta.env.VITE_ZOUK_CHANNEL || 'all').replace(/^#/, '');
const DEFAULT_GUEST_PICTURE = import.meta.env.VITE_ZOUK_GUEST_PICTURE || '';
const DEFAULT_GUEST_GRAVATAR_URL = import.meta.env.VITE_ZOUK_GUEST_GRAVATAR_URL || '';
const STORAGE_KEYS = {
  serverUrl: 'zouk.embed.serverUrl',
  workspaceId: 'zouk.embed.workspaceId',
  channel: 'zouk.embed.channel',
  guestName: 'zouk.embed.name',
  browserId: 'zouk.embed.browserId',
};

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function createBrowserId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getBrowserId() {
  const existing = readStored(STORAGE_KEYS.browserId, '');
  if (existing) return existing;
  const next = createBrowserId();
  writeStored(STORAGE_KEYS.browserId, next);
  return next;
}

function guestNameForBrowser(browserId) {
  const suffix = String(browserId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toLowerCase() || 'guest';
  return `studio-reader-${suffix}`;
}

function px(value) {
  return `${Math.max(0, Math.round(value))}px`;
}

function wsUrlFor(serverUrl, token, workspaceId) {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  url.searchParams.set('workspaceId', workspaceId);
  return url.toString();
}

function currentSourceUrl() {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}

function normalizeMessage(message) {
  if (!message) return null;
  return {
    id: message.id || message.messageId,
    content: message.content || '',
    senderName: message.senderName || message.sender_name || 'unknown',
    senderType: message.senderType || message.sender_type || 'human',
    senderPicture: message.senderPicture || message.sender_picture || '',
    senderGravatarUrl: message.senderGravatarUrl || message.sender_gravatar_url || message.gravatarUrl || '',
    channelName: message.channelName || message.channel_name || '',
    createdAt: message.createdAt || message.timestamp || new Date().toISOString(),
  };
}

function isSystemMessage(message) {
  return message?.senderType === 'system' || message?.senderName === 'system';
}

function mergeMessage(list, incoming) {
  if (!incoming?.id || isSystemMessage(incoming)) return list;
  if (list.some((message) => message.id === incoming.id)) return list;
  return [...list, incoming].slice(-120);
}

async function parseJsonResponse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

function compactSelection(text) {
  return text.trim().replace(/\s+/g, ' ').slice(0, 900);
}

function sourceContext(sourceUrl, selectedText = '') {
  const parts = [`Source: ${sourceUrl}`];
  if (selectedText) {
    parts.push(`Selected text:\n"${compactSelection(selectedText)}"`);
  }
  return parts.join('\n\n');
}

function withSourcePrefix(content, sourceUrl, selectedText = '') {
  const trimmed = content.trim();
  if (/^source:\s*/i.test(trimmed)) return trimmed;
  return `${sourceContext(sourceUrl, selectedText)}\n\n${trimmed}`;
}

function canSendComposer(content) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return true;
}

function visibleMessageContent(content) {
  return String(content || '').replace(/^Source:[^\n]*(?:\n\nSelected text:\n"[\s\S]*?")?\n\n/, '');
}

function avatarInitial(name) {
  const clean = String(name || '?').replace(/^@/, '').trim();
  return (clean[0] || '?').toUpperCase();
}

function avatarPayloadFromStorage() {
  const payload = {};
  try {
    const picture = localStorage.getItem('zouk.embed.picture') || DEFAULT_GUEST_PICTURE;
    const gravatarUrl = localStorage.getItem('zouk.embed.gravatarUrl') || DEFAULT_GUEST_GRAVATAR_URL;
    if (picture) payload.picture = picture;
    if (gravatarUrl) payload.gravatarUrl = gravatarUrl;
  } catch {
    if (DEFAULT_GUEST_PICTURE) payload.picture = DEFAULT_GUEST_PICTURE;
    if (DEFAULT_GUEST_GRAVATAR_URL) payload.gravatarUrl = DEFAULT_GUEST_GRAVATAR_URL;
  }
  return payload;
}

function Avatar({ avatar, name, agent = false }) {
  const src = avatar?.picture || avatar?.gravatarUrl || '';
  return (
    <div className={'zouk-avatar ' + (agent ? 'agent' : '')}>
      {src ? <img src={src} alt="" /> : <span>{avatarInitial(name)}</span>}
    </div>
  );
}

export function ZoukEmbedPage() {
  const [browserId] = useState(getBrowserId);
  const [serverUrl, setServerUrl] = useState(() => readStored(STORAGE_KEYS.serverUrl, DEFAULT_SERVER_URL));
  const [workspaceId, setWorkspaceId] = useState(() => readStored(STORAGE_KEYS.workspaceId, DEFAULT_WORKSPACE_ID));
  const [channel, setChannel] = useState(() => readStored(STORAGE_KEYS.channel, DEFAULT_CHANNEL));
  const [guestName, setGuestName] = useState(() => readStored(STORAGE_KEYS.guestName, guestNameForBrowser(getBrowserId())));
  const [token, setToken] = useState('');
  const [userName, setUserName] = useState('');
  const [selfAvatar, setSelfAvatar] = useState(null);
  const [avatarMap, setAvatarMap] = useState({});
  const [messages, setMessages] = useState([]);
  const [composer, setComposer] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 761px)').matches
      : false
  ));
  const [sourceUrl, setSourceUrl] = useState(currentSourceUrl);
  const [selectionAction, setSelectionAction] = useState(null);
  const articleRef = useRef(null);
  const textareaRef = useRef(null);
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const closeTimerRef = useRef(null);
  const sheetHeightRef = useRef(0);

  const target = useMemo(() => `#${channel.replace(/^#/, '') || 'all'}`, [channel]);
  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Workspace-Id': encodeURIComponent(workspaceId),
  }), [token, workspaceId]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => !isSystemMessage(message)),
    [messages],
  );
  const showChat = chatOpen || sheetClosing || isDesktop;

  useEffect(() => writeStored(STORAGE_KEYS.serverUrl, serverUrl), [serverUrl]);
  useEffect(() => writeStored(STORAGE_KEYS.workspaceId, workspaceId), [workspaceId]);
  useEffect(() => writeStored(STORAGE_KEYS.channel, channel.replace(/^#/, '') || 'all'), [channel]);
  useEffect(() => writeStored(STORAGE_KEYS.guestName, guestName), [guestName]);

  const rememberSource = useCallback(() => {
    const next = currentSourceUrl();
    setSourceUrl(next);
    return next;
  }, []);

  const openChat = useCallback((selectedText = '') => {
    rememberSource();
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setSheetClosing(false);
    setSheetDragY(0);
    setChatOpen(true);
    setSelectionAction(null);
    setSelectedText(compactSelection(selectedText));
    setComposer((prev) => {
      if (prev.trim()) return prev;
      return '';
    });
    if (isDesktop) window.setTimeout(() => textareaRef.current?.focus(), 80);
  }, [isDesktop, rememberSource]);

  const closeChat = useCallback(() => {
    if (isDesktop) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setSheetDragging(false);
    setSheetDragY(0);
    setSheetClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setChatOpen(false);
      setSheetClosing(false);
      closeTimerRef.current = null;
    }, 210);
  }, [isDesktop]);

  const startSheetDrag = useCallback((event) => {
    if (isDesktop || event.button > 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSheetDragging(true);
    setSheetDragY(0);
  }, [isDesktop]);

  const moveSheetDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const delta = Math.max(0, event.clientY - drag.startY);
    const dt = Math.max(1, now - drag.lastTime);
    drag.velocity = (event.clientY - drag.lastY) / dt;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    setSheetDragY(delta);
  }, []);

  const endSheetDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = Math.max(0, event.clientY - drag.startY);
    const shouldClose = delta > 92 || (delta > 42 && drag.velocity > 0.7);
    dragRef.current = null;
    setSheetDragging(false);
    if (shouldClose) {
      closeChat();
    } else {
      setSheetDragY(0);
    }
  }, [closeChat]);

  const updateSelectionAction = useCallback(() => {
    const selection = window.getSelection?.();
    const text = selection?.toString().trim() || '';
    if (!text || !selection.rangeCount || !articleRef.current) {
      setSelectionAction(null);
      return;
    }
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (!articleRef.current.contains(anchor) || !articleRef.current.contains(focus)) {
      setSelectionAction(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      setSelectionAction(null);
      return;
    }
    setSelectionAction({
      text,
      top: Math.max(64, rect.top - 46),
      left: Math.min(window.innerWidth - 78, Math.max(78, rect.left + rect.width / 2)),
    });
  }, []);

  const loadHistory = useCallback(async (nextToken = token) => {
    if (!nextToken) return;
    const res = await fetch(`${serverUrl}/api/messages`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nextToken}`,
        'X-Workspace-Id': encodeURIComponent(workspaceId),
        'X-Channel': target,
        'X-Limit': '80',
      },
      cache: 'no-store',
    });
    const body = await parseJsonResponse(res);
    setMessages((body.messages || []).map(normalizeMessage).filter((message) => message && !isSystemMessage(message)));
  }, [serverUrl, target, token, workspaceId]);

  const connect = useCallback(async () => {
    const cleanName = guestName.trim() || guestNameForBrowser(browserId);
    setStatus('connecting');
    setError('');
    try {
      writeStored(STORAGE_KEYS.guestName, cleanName);
      const res = await fetch(`${serverUrl}/api/auth/embed-guest-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          channel: channel.replace(/^#/, '') || 'all',
          name: cleanName,
          browserId,
          ...avatarPayloadFromStorage(),
        }),
      });
      const body = await parseJsonResponse(res);
      const nextUserName = body.user?.name || cleanName;
      const nextSelfAvatar = {
        picture: body.user?.picture || '',
        gravatarUrl: body.user?.gravatarUrl || '',
      };
      setToken(body.token);
      setUserName(nextUserName);
      setSelfAvatar(nextSelfAvatar);
      setAvatarMap((prev) => ({
        ...prev,
        [nextUserName]: nextSelfAvatar,
      }));
      await loadHistory(body.token);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unable to connect');
    }
  }, [browserId, channel, guestName, loadHistory, serverUrl, workspaceId]);

  useEffect(() => {
    if (!showChat || token || status === 'connecting' || status === 'error') return;
    const timer = window.setTimeout(() => connect(), 0);
    return () => window.clearTimeout(timer);
  }, [connect, showChat, status, token]);

  useEffect(() => {
    if (!token) return undefined;
    const ws = new WebSocket(wsUrlFor(serverUrl, token, workspaceId));
    wsRef.current = ws;
    ws.onopen = () => setStatus('connected');
    ws.onclose = () => setStatus(prev => (prev === 'error' ? prev : 'closed'));
    ws.onerror = () => setStatus('error');
    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'ping') return;
        if (packet.type === 'init') {
          const nextAvatars = {};
          for (const human of packet.humans || []) {
            if (human?.name) nextAvatars[human.name] = { picture: human.picture || '', gravatarUrl: human.gravatarUrl || '' };
          }
          for (const agent of packet.agents || []) {
            if (agent?.name) nextAvatars[agent.name] = { picture: agent.picture || '', gravatarUrl: '' };
            if (agent?.displayName) nextAvatars[agent.displayName] = { picture: agent.picture || '', gravatarUrl: '' };
          }
          setAvatarMap((prev) => ({ ...prev, ...nextAvatars }));
          setStatus('connected');
          return;
        }
        if ((packet.type === 'message' || packet.type === 'new_message') && packet.message) {
          const next = normalizeMessage(packet.message);
          if (next?.channelName === channel.replace(/^#/, '')) {
            setMessages(prev => mergeMessage(prev, next));
          }
        }
      } catch {
        // Ignore malformed websocket frames.
      }
    };
    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [channel, serverUrl, token, workspaceId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visibleMessages.length, chatOpen]);

  useEffect(() => {
    const update = () => setSourceUrl(currentSourceUrl());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 761px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!showChat || isDesktop) return undefined;

    const root = document.documentElement;
    let raf = 0;
    const layoutHeight = Math.max(
      document.documentElement.clientHeight || 0,
      window.innerHeight || 0,
      window.visualViewport?.height || 0,
    );
    sheetHeightRef.current = layoutHeight * 0.5;
    root.style.setProperty('--zouk-sheet-height', px(sheetHeightRef.current));

    const syncViewport = () => {
      raf = 0;
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      root.style.setProperty('--zouk-sheet-vv-top', px(viewport?.offsetTop ?? 0));
      root.style.setProperty('--zouk-sheet-vv-height', px(viewportHeight));
    };
    const scheduleViewport = () => {
      if (raf) return;
      raf = requestAnimationFrame(syncViewport);
    };

    syncViewport();
    window.addEventListener('resize', scheduleViewport, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleViewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleViewport, { passive: true });

    return () => {
      window.removeEventListener('resize', scheduleViewport);
      window.visualViewport?.removeEventListener('resize', scheduleViewport);
      window.visualViewport?.removeEventListener('scroll', scheduleViewport);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty('--zouk-sheet-vv-top');
      root.style.removeProperty('--zouk-sheet-vv-height');
      root.style.removeProperty('--zouk-sheet-height');
    };
  }, [isDesktop, showChat]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const send = async (e) => {
    e.preventDefault();
    const content = withSourcePrefix(composer, sourceUrl, selectedText);
    if (!canSendComposer(composer) || !token || status === 'sending') return;
    setStatus('sending');
    setError('');
    try {
      const res = await fetch(`${serverUrl}/api/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ target, content }),
      });
      const body = await parseJsonResponse(res);
      setMessages(prev => mergeMessage(prev, normalizeMessage(body.message)));
      rememberSource();
      setSelectedText('');
      setComposer('');
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  };

  const hasSession = !!token;

  return (
    <div className="zouk-blog-page" data-theme="washi">
      <OpenVikingBlogArticle
        articleRef={articleRef}
        selectionAction={selectionAction}
        showSelectionAsk={!!selectionAction && (!chatOpen || isDesktop)}
        onAskSelection={openChat}
        onMouseUp={() => window.setTimeout(updateSelectionAction, 0)}
        onTouchEnd={() => window.setTimeout(updateSelectionAction, 120)}
      />

      {!showChat && (
        <button className="zouk-launcher" type="button" onClick={() => openChat()}>
          <Icon name="message" size={17} />
          Ask Zouk
        </button>
      )}

      {showChat && (
        <aside
          className={
            'zouk-chat-dialog'
            + (sheetClosing ? ' closing' : '')
            + (sheetDragging ? ' dragging' : '')
          }
          style={!isDesktop ? { '--zouk-sheet-drag': `${sheetDragY}px` } : undefined}
          aria-label="Zouk chat"
        >
          <div
            className="zouk-sheet-drag-zone"
            onPointerDown={startSheetDrag}
            onPointerMove={moveSheetDrag}
            onPointerUp={endSheetDrag}
            onPointerCancel={endSheetDrag}
          >
            <div className="zouk-sheet-handle" />
          </div>

          {!hasSession ? (
            <div className="zouk-sheet-scroll">
              <div className="zouk-connect">
                <div className="zouk-connect-title">
                  <span className={status === 'connecting' ? 'spinner' : ''} />
                  {status === 'connecting' ? 'Connecting to Zouk...' : 'Connect to Zouk'}
                </div>
                {status === 'error' && (
                  <>
                    <label className="label">Zouk server</label>
                    <input className="input mono" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} />
                    <div className="zouk-two">
                      <div>
                        <label className="label">Workspace</label>
                        <input className="input mono" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} />
                      </div>
                      <div>
                        <label className="label">Channel</label>
                        <input className="input mono" value={channel} onChange={(event) => setChannel(event.target.value)} />
                      </div>
                    </div>
                    <label className="label">Display name</label>
                    <input className="input" value={guestName} onChange={(event) => setGuestName(event.target.value)} />
                  </>
                )}
                <button className="btn btn-primary" type="button" onClick={connect} disabled={status === 'connecting'}>
                  <Icon name={status === 'connecting' ? 'refresh' : 'message'} size={14} className={status === 'connecting' ? 'spin-ic' : undefined} />
                  {status === 'connecting' ? 'Connecting' : 'Retry'}
                </button>
              </div>
              {error && <div className="zouk-error mono">{error}</div>}
            </div>
          ) : (
            <>
              <div className="zouk-messages" ref={scrollRef}>
                {visibleMessages.length === 0 ? (
                  <div className="zouk-empty">No channel messages yet.</div>
                ) : visibleMessages.map((message) => {
                  const mine = message.senderName === userName;
                  const avatar = mine
                    ? selfAvatar
                    : avatarMap[message.senderName] || {
                      picture: message.senderPicture,
                      gravatarUrl: message.senderGravatarUrl,
                    };
                  return (
                    <div
                      key={message.id}
                      className={'zouk-chat-line ' + (mine ? 'mine' : '')}
                    >
                      {!mine && <Avatar avatar={avatar} name={message.senderName} agent={message.senderType === 'agent'} />}
                      <div className="zouk-bubble-wrap">
                        {!mine && (
                          <div className="zouk-message-head">
                            <span>{message.senderName}</span>
                            <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                          </div>
                        )}
                        <div className="zouk-message-body">{visibleMessageContent(message.content)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form className="zouk-composer" onSubmit={send}>
                <textarea
                  ref={textareaRef}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send(event);
                    }
                  }}
                  enterKeyHint="send"
                  placeholder="Ask a follow-up..."
                />
                <button className="btn btn-primary btn-icon zouk-composer-send" disabled={!canSendComposer(composer) || status === 'sending'} title="Send">
                  <Icon name={status === 'sending' ? 'refresh' : 'share'} size={14} className={status === 'sending' ? 'spin-ic' : undefined} />
                </button>
              </form>
              {error && <div className="zouk-error mono">{error}</div>}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
