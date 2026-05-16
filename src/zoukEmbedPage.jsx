import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './components';

const DEFAULT_SERVER_URL = import.meta.env.VITE_ZOUK_SERVER_URL || 'https://zouk.zaynjarvis.com';
const DEFAULT_WORKSPACE_ID = import.meta.env.VITE_ZOUK_WORKSPACE_ID || 'default';
const DEFAULT_CHANNEL = (import.meta.env.VITE_ZOUK_CHANNEL || 'all').replace(/^#/, '');

function wsUrlFor(serverUrl, token, workspaceId) {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  url.searchParams.set('workspaceId', workspaceId);
  return url.toString();
}

function normalizeMessage(message) {
  if (!message) return null;
  return {
    id: message.id || message.messageId,
    content: message.content || '',
    senderName: message.senderName || message.sender_name || 'unknown',
    senderType: message.senderType || message.sender_type || 'human',
    channelName: message.channelName || message.channel_name || '',
    createdAt: message.createdAt || message.timestamp || new Date().toISOString(),
  };
}

function mergeMessage(list, incoming) {
  if (!incoming?.id) return list;
  if (list.some((message) => message.id === incoming.id)) return list;
  return [...list, incoming].slice(-120);
}

async function parseJsonResponse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export function ZoukEmbedPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [workspaceId, setWorkspaceId] = useState(DEFAULT_WORKSPACE_ID);
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [guestName, setGuestName] = useState(() => localStorage.getItem('zouk.embed.name') || 'studio-reader');
  const [token, setToken] = useState('');
  const [userName, setUserName] = useState('');
  const [messages, setMessages] = useState([]);
  const [composer, setComposer] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const wsRef = useRef(null);
  const scrollRef = useRef(null);

  const target = useMemo(() => `#${channel.replace(/^#/, '') || 'all'}`, [channel]);
  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Workspace-Id': encodeURIComponent(workspaceId),
  }), [token, workspaceId]);

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
    setMessages((body.messages || []).map(normalizeMessage).filter(Boolean));
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
        }),
      });
      const body = await parseJsonResponse(res);
      setToken(body.token);
      setUserName(body.user?.name || cleanName);
      await loadHistory(body.token);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unable to connect');
    }
  }, [channel, guestName, loadHistory, serverUrl, workspaceId]);

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
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const content = composer.trim();
    if (!content || !token || status === 'sending') return;
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
      setComposer('');
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  };

  const hasSession = !!token;
  const online = hasSession && (status === 'connected' || status === 'sending');

  return (
    <div className="zouk-mvp">
      <article className="zouk-article">
        <div className="chip">External site MVP</div>
        <h1 className="display zouk-article-title">Creative systems note</h1>
        <p className="zouk-lede">
          This page stands in for a blog or documentation site. The chat rail is a separate Zouk channel client mounted by the host page.
        </p>
        <div className="zouk-article-body">
          <p>
            The outside site owns its own content, layout and product semantics. Zouk only provides a scoped channel chat session, live websocket delivery and the same history that appears in the workspace.
          </p>
          <p>
            Messages sent here are normal messages in the configured Zouk workspace channel. Switching back to Zouk should show the same conversation in that channel and allow continuation from either surface.
          </p>
          <p>
            The MVP intentionally avoids hidden article context injection. Any context an agent receives must be visible as messages in the channel.
          </p>
        </div>
      </article>

      <aside className="zouk-chat-rail">
        <div className="zouk-chat-top">
          <div>
            <div className="zouk-kicker mono">Zouk channel</div>
            <h2>#{channel.replace(/^#/, '') || 'all'}</h2>
          </div>
          <span className={'zouk-status ' + (online ? 'ok' : status === 'error' ? 'bad' : '')}>
            {online ? 'connected' : status}
          </span>
        </div>

        {!hasSession && (
          <div className="zouk-connect">
            <label className="label">Zouk server</label>
            <input className="input mono" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
            <div className="zouk-two">
              <div>
                <label className="label">Workspace</label>
                <input className="input mono" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
              </div>
              <div>
                <label className="label">Channel</label>
                <input className="input mono" value={channel} onChange={(e) => setChannel(e.target.value)} />
              </div>
            </div>
            <label className="label">Display name</label>
            <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            <button className="btn btn-primary" onClick={connect} disabled={status === 'connecting'}>
              <Icon name={status === 'connecting' ? 'refresh' : 'message'} size={14} className={status === 'connecting' ? 'spin-ic' : undefined} />
              {status === 'connecting' ? 'Connecting' : 'Connect to Zouk'}
            </button>
          </div>
        )}

        {hasSession && (
          <>
            <div className="zouk-chat-meta mono">
              <span>{userName}</span>
              <span>{workspaceId}</span>
            </div>
            <div className="zouk-messages" ref={scrollRef}>
              {messages.length === 0 ? (
                <div className="zouk-empty">No messages in this channel yet.</div>
              ) : messages.map(message => (
                <div
                  key={message.id}
                  className={'zouk-message ' + (message.senderName === userName ? 'mine' : '')}
                >
                  <div className="zouk-message-head mono">
                    <span>{message.senderName}</span>
                    <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="zouk-message-body">{message.content}</div>
                </div>
              ))}
            </div>
            <form className="zouk-composer" onSubmit={send}>
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(e);
                  }
                }}
                placeholder="Message the Zouk channel"
              />
              <button className="btn btn-primary btn-icon" disabled={!composer.trim() || status === 'sending'} title="Send">
                <Icon name={status === 'sending' ? 'refresh' : 'share'} size={14} className={status === 'sending' ? 'spin-ic' : undefined} />
              </button>
            </form>
          </>
        )}

        {error && <div className="zouk-error mono">{error}</div>}
      </aside>
    </div>
  );
}
