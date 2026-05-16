import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './components';

const DEFAULT_SERVER_URL = import.meta.env.VITE_ZOUK_SERVER_URL || 'https://zouk.zaynjarvis.com';
const DEFAULT_WORKSPACE_ID = import.meta.env.VITE_ZOUK_WORKSPACE_ID || 'default';
const DEFAULT_CHANNEL = (import.meta.env.VITE_ZOUK_CHANNEL || 'all').replace(/^#/, '');
const DEFAULT_GUEST_PICTURE = import.meta.env.VITE_ZOUK_GUEST_PICTURE || '';
const DEFAULT_GUEST_GRAVATAR_URL = import.meta.env.VITE_ZOUK_GUEST_GRAVATAR_URL || '';

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

function sourceDraft(sourceUrl, selectedText = '') {
  const parts = [`Source: ${sourceUrl}`];
  if (selectedText) {
    parts.push(`Selected text:\n"${compactSelection(selectedText)}"`);
  }
  return `${parts.join('\n\n')}\n\n`;
}

function withSourcePrefix(content, sourceUrl) {
  const trimmed = content.trim();
  if (/^source:\s*/i.test(trimmed)) return trimmed;
  return `${sourceDraft(sourceUrl).trim()}\n\n${trimmed}`;
}

function canSendComposer(content, sourceUrl) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed === sourceDraft(sourceUrl).trim()) return false;
  return true;
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
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [workspaceId, setWorkspaceId] = useState(DEFAULT_WORKSPACE_ID);
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [guestName, setGuestName] = useState(() => localStorage.getItem('zouk.embed.name') || 'studio-reader');
  const [token, setToken] = useState('');
  const [userName, setUserName] = useState('');
  const [selfAvatar, setSelfAvatar] = useState(null);
  const [avatarMap, setAvatarMap] = useState({});
  const [messages, setMessages] = useState([]);
  const [composer, setComposer] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
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
  const showChat = chatOpen || isDesktop;

  const rememberSource = useCallback(() => {
    const next = currentSourceUrl();
    setSourceUrl(next);
    return next;
  }, []);

  const openChat = useCallback((selectedText = '') => {
    const nextSourceUrl = rememberSource();
    setChatOpen(true);
    setSelectionAction(null);
    setComposer((prev) => {
      if (prev.trim() && !selectedText) return prev;
      return sourceDraft(nextSourceUrl, selectedText);
    });
    window.setTimeout(() => textareaRef.current?.focus(), 80);
  }, [rememberSource]);

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
    const cleanName = guestName.trim() || 'studio-reader';
    setStatus('connecting');
    setError('');
    try {
      localStorage.setItem('zouk.embed.name', cleanName);
      const res = await fetch(`${serverUrl}/api/auth/embed-guest-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          channel: channel.replace(/^#/, '') || 'all',
          name: cleanName,
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
  }, [channel, guestName, loadHistory, serverUrl, workspaceId]);

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

  const send = async (e) => {
    e.preventDefault();
    const content = withSourcePrefix(composer, sourceUrl);
    if (!canSendComposer(composer, sourceUrl) || !token || status === 'sending') return;
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
      setComposer(sourceDraft(rememberSource()));
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  };

  const hasSession = !!token;
  const online = hasSession && (status === 'connected' || status === 'sending');
  const channelName = channel.replace(/^#/, '') || 'all';

  return (
    <div className="zouk-blog-page">
      <header className="zouk-blog-bar">
        <strong>Product Guide</strong>
        <button className="zouk-menu-button" type="button" aria-label="Open menu">
          <span />
          <span />
          <span />
        </button>
      </header>

      <main
        className="zouk-article"
        ref={articleRef}
        onMouseUp={() => window.setTimeout(updateSelectionAction, 0)}
        onTouchEnd={() => window.setTimeout(updateSelectionAction, 120)}
      >
        <div className="zouk-breadcrumb">Guide / Quickstart</div>
        <h1 className="zouk-article-title">Install the widget</h1>
        <p className="zouk-lede">
          Add the script and channel element to any mobile documentation page.
        </p>
        <button className="zouk-inline-ask" type="button" onClick={() => openChat()}>
          <Icon name="message" size={15} />
          Ask Zouk about this page
        </button>
        <div className="zouk-article-card" aria-hidden="true" />
        <div className="zouk-article-body">
          <p>
            The host page controls the article and calls Zouk only for a scoped chat session. Readers can ask from the page without receiving broader workspace access.
          </p>
          <p>
            Selecting text opens the same chat with the selected passage placed in the draft. The source URL is included before the question so the channel has visible context.
          </p>
          <p>
            The conversation is shared with the configured Zouk channel, while system messages stay hidden in this embedded view.
          </p>
        </div>
      </main>

      {selectionAction && (!chatOpen || isDesktop) && (
        <button
          className="zouk-selection-ask"
          type="button"
          style={{ top: selectionAction.top, left: selectionAction.left }}
          onClick={() => openChat(selectionAction.text)}
        >
          <Icon name="message" size={13} />
          Ask Zouk
        </button>
      )}

      {!showChat && (
        <button className="zouk-launcher" type="button" onClick={() => openChat()}>
          <Icon name="message" size={17} />
          Ask Zouk
        </button>
      )}

      {showChat && (
        <aside className="zouk-chat-dialog" aria-label="Zouk chat">
          <div className="zouk-sheet-handle" />
          <div className="zouk-chat-top">
            <div>
              <h2>Ask Zouk</h2>
              <span>#{channelName}</span>
            </div>
            <div className="zouk-top-actions">
              <span className={'zouk-status ' + (online ? 'ok' : status === 'error' ? 'bad' : '')}>
                {online ? 'online' : status}
              </span>
              <button className="zouk-close" type="button" onClick={() => setChatOpen(false)} aria-label="Collapse chat">
                <Icon name="x" size={15} />
              </button>
            </div>
          </div>

          <div className="zouk-source-card">
            <span>Source</span>
            <strong>{sourceUrl}</strong>
          </div>

          {!hasSession && (
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
          )}

          {hasSession && (
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
                        <div className="zouk-message-body">{message.content}</div>
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
                  placeholder="Ask a follow-up..."
                />
                <button className="btn btn-primary btn-icon" disabled={!canSendComposer(composer, sourceUrl) || status === 'sending'} title="Send">
                  <Icon name={status === 'sending' ? 'refresh' : 'share'} size={14} className={status === 'sending' ? 'spin-ic' : undefined} />
                </button>
              </form>
            </>
          )}

          {error && <div className="zouk-error mono">{error}</div>}
        </aside>
      )}
    </div>
  );
}
