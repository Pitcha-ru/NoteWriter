import { Env } from './types'
import { json } from './index'

// Simple hash for admin token cookie
async function hashToken(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(password + salt)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? match[1] : null
}

export async function handleAdminRequest(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'Admin not configured' }, 500)
  }

  const salt = 'notewriter-admin-salt'
  const expectedToken = await hashToken(env.ADMIN_PASSWORD, salt)

  // Login endpoint
  if (path === '/admin/login' && request.method === 'POST') {
    const body = await request.json<{ password: string }>()
    if (body.password !== env.ADMIN_PASSWORD) {
      return json({ error: 'Invalid password' }, 401)
    }
    const token = await hashToken(body.password, salt)
    const res = json({ ok: true })
    res.headers.set('Set-Cookie', `admin_token=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`)
    return res
  }

  // Serve admin HTML page
  if (path === '/admin' && request.method === 'GET') {
    return new Response(adminHtml(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // All other /admin/* routes require auth
  const token = getCookie(request, 'admin_token')
  if (token !== expectedToken) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // API routes
  return handleAdminApi(request, env, path)
}

async function handleAdminApi(request: Request, env: Env, path: string): Promise<Response | null> {
  const db = env.DB

  // GET /admin/api/devices
  if (path === '/admin/api/devices' && request.method === 'GET') {
    const result = await db.prepare('SELECT DISTINCT device_id FROM devices ORDER BY device_id').all()
    return json(result.results)
  }

  // GET /admin/api/groups
  if (path === '/admin/api/groups' && request.method === 'GET') {
    const result = await db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all()
    return json(result.results)
  }

  // POST /admin/api/groups
  if (path === '/admin/api/groups' && request.method === 'POST') {
    const body = await request.json<{ name: string }>()
    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').bind(id, body.name).run()
    const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first()
    return json(group, 201)
  }

  // Group-specific routes
  const groupMatch = path.match(/^\/admin\/api\/groups\/([^/]+)$/)
  if (groupMatch) {
    const groupId = groupMatch[1]
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM groups WHERE id = ?').bind(groupId).run()
      return json({ ok: true })
    }
  }

  // Devices in group
  const devicesMatch = path.match(/^\/admin\/api\/groups\/([^/]+)\/devices$/)
  if (devicesMatch) {
    const groupId = devicesMatch[1]
    if (request.method === 'GET') {
      const result = await db.prepare('SELECT device_id FROM group_devices WHERE group_id = ?').bind(groupId).all()
      return json(result.results)
    }
    if (request.method === 'POST') {
      const body = await request.json<{ device_id: string }>()
      await db.prepare('INSERT OR IGNORE INTO group_devices (group_id, device_id) VALUES (?, ?)').bind(groupId, body.device_id).run()
      return json({ ok: true }, 201)
    }
  }

  // Remove device from group
  const removeDeviceMatch = path.match(/^\/admin\/api\/groups\/([^/]+)\/devices\/([^/]+)$/)
  if (removeDeviceMatch) {
    const [, groupId, deviceId] = removeDeviceMatch
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM group_devices WHERE group_id = ? AND device_id = ?').bind(groupId, deviceId).run()
      return json({ ok: true })
    }
  }

  // Group notes
  const notesMatch = path.match(/^\/admin\/api\/groups\/([^/]+)\/notes$/)
  if (notesMatch) {
    const groupId = notesMatch[1]
    if (request.method === 'GET') {
      const result = await db.prepare('SELECT * FROM group_notes WHERE group_id = ? ORDER BY created_at DESC').bind(groupId).all()
      return json(result.results)
    }
    if (request.method === 'POST') {
      const body = await request.json<{ title: string; content: string }>()
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO group_notes (id, group_id, title, content) VALUES (?, ?, ?, ?)').bind(id, groupId, body.title ?? '', body.content ?? '').run()
      const note = await db.prepare('SELECT * FROM group_notes WHERE id = ?').bind(id).first()
      return json(note, 201)
    }
  }

  // Single group note
  const noteMatch = path.match(/^\/admin\/api\/groups\/([^/]+)\/notes\/([^/]+)$/)
  if (noteMatch) {
    const [, groupId, noteId] = noteMatch
    if (request.method === 'PUT') {
      const body = await request.json<{ title: string; content: string }>()
      await db.prepare('UPDATE group_notes SET title = ?, content = ? WHERE id = ? AND group_id = ?').bind(body.title ?? '', body.content ?? '', noteId, groupId).run()
      return json({ ok: true })
    }
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM group_notes WHERE id = ? AND group_id = ?').bind(noteId, groupId).run()
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
}

function adminHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NoteWriter Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f0f0; color: #1a1a1a; min-height: 100vh; }

  /* Login */
  .login-screen { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-card { background: #fff; border-radius: 14px; padding: 32px; width: 320px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .login-card h1 { font-size: 20px; margin-bottom: 20px; text-align: center; }
  .login-card input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; margin-bottom: 14px; }
  .login-card button { width: 100%; padding: 10px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .login-card button:hover { background: #333; }
  .login-error { color: #d32f2f; font-size: 13px; margin-bottom: 10px; display: none; }

  /* Layout */
  .app { display: flex; min-height: 100vh; }
  .sidebar { width: 260px; background: #fff; border-right: 1px solid #e0e0e0; padding: 16px; overflow-y: auto; flex-shrink: 0; }
  .main { flex: 1; padding: 24px; overflow-y: auto; }

  .sidebar h2 { font-size: 16px; margin-bottom: 12px; }
  .group-list { list-style: none; }
  .group-list li { padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
  .group-list li:hover { background: #f5f5f5; }
  .group-list li.active { background: #e8e8e8; font-weight: 600; }
  .group-list li .del-group { opacity: 0; background: none; border: none; color: #999; cursor: pointer; font-size: 16px; padding: 0 4px; }
  .group-list li:hover .del-group { opacity: 1; }
  .group-list li .del-group:hover { color: #d32f2f; }

  .btn { display: inline-block; padding: 8px 16px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; }
  .btn:hover { background: #333; }
  .btn-sm { padding: 5px 10px; font-size: 12px; }
  .btn-danger { background: #d32f2f; }
  .btn-danger:hover { background: #b71c1c; }
  .btn-outline { background: #fff; color: #1a1a1a; border: 1px solid #ddd; }
  .btn-outline:hover { background: #f5f5f5; }

  .card { background: #fff; border-radius: 14px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
  .card h3 { font-size: 15px; margin-bottom: 12px; color: #555; }

  input[type="text"], textarea, select {
    width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; font-family: inherit;
  }
  textarea { resize: vertical; min-height: 100px; }
  label { font-size: 13px; color: #666; display: block; margin-bottom: 4px; }
  .field { margin-bottom: 12px; }

  .device-tag { display: inline-flex; align-items: center; gap: 4px; background: #f0f0f0; padding: 4px 10px; border-radius: 6px; font-size: 13px; margin: 2px 4px 2px 0; }
  .device-tag button { background: none; border: none; color: #999; cursor: pointer; font-size: 14px; padding: 0 2px; }
  .device-tag button:hover { color: #d32f2f; }

  .note-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
  .note-row:last-child { border-bottom: none; }
  .note-row .note-title { font-weight: 500; font-size: 14px; cursor: pointer; flex: 1; }
  .note-row .note-title:hover { color: #555; }
  .note-row .actions { display: flex; gap: 6px; }

  .empty { color: #999; font-size: 13px; padding: 8px 0; }
  .add-row { display: flex; gap: 8px; margin-top: 8px; }
  .add-row select, .add-row input { flex: 1; }

  .hidden { display: none !important; }
</style>
</head>
<body>

<div id="login" class="login-screen">
  <div class="login-card">
    <h1>NoteWriter Admin</h1>
    <div id="login-error" class="login-error">Invalid password</div>
    <input type="password" id="login-pw" placeholder="Admin password" autofocus>
    <button id="login-btn">Login</button>
  </div>
</div>

<div id="app" class="app hidden">
  <div class="sidebar">
    <h2>Groups</h2>
    <ul id="group-list" class="group-list"></ul>
    <div style="margin-top:12px;">
      <button id="new-group-btn" class="btn" style="width:100%">+ New Group</button>
    </div>
  </div>
  <div class="main">
    <div id="no-selection" style="color:#999;margin-top:40px;text-align:center;">Select or create a group</div>
    <div id="group-detail" class="hidden">
      <div class="card">
        <h3>Group Name</h3>
        <div class="field"><input type="text" id="group-name" placeholder="Group name"></div>
      </div>

      <div class="card">
        <h3>Devices</h3>
        <div id="device-tags"></div>
        <div class="add-row">
          <select id="device-select"><option value="">Add device...</option></select>
          <button id="add-device-btn" class="btn btn-sm">Add</button>
        </div>
      </div>

      <div class="card">
        <h3>Notes</h3>
        <div id="notes-list"></div>
        <div style="margin-top:12px;"><button id="new-note-btn" class="btn btn-sm">+ New Note</button></div>
      </div>

      <div id="note-editor" class="card hidden">
        <h3 id="note-editor-title-label">New Note</h3>
        <div class="field"><label>Title</label><input type="text" id="note-title"></div>
        <div class="field"><label>Content</label><textarea id="note-content" rows="6"></textarea></div>
        <div style="display:flex;gap:8px;">
          <button id="save-note-btn" class="btn btn-sm">Save</button>
          <button id="cancel-note-btn" class="btn btn-sm btn-outline">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  const $ = (s) => document.querySelector(s);
  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(body.error);
    }
    return res.json();
  };

  let selectedGroupId = null;
  let editingNoteId = null;
  let allDevices = [];
  let groupDevices = [];

  // Login
  $('#login-btn').onclick = async () => {
    const pw = $('#login-pw').value;
    try {
      await api('/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
      $('#login').classList.add('hidden');
      $('#app').classList.remove('hidden');
      loadGroups();
      loadAllDevices();
    } catch (e) {
      $('#login-error').style.display = 'block';
      $('#login-error').textContent = e.message || 'Invalid password';
    }
  };
  $('#login-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#login-btn').click(); });

  // Try to see if already authed
  (async () => {
    try {
      await api('/admin/api/groups');
      $('#login').classList.add('hidden');
      $('#app').classList.remove('hidden');
      loadGroups();
      loadAllDevices();
    } catch {}
  })();

  async function loadAllDevices() {
    try {
      allDevices = await api('/admin/api/devices');
    } catch {}
  }

  async function loadGroups() {
    try {
      const groups = await api('/admin/api/groups');
      const list = $('#group-list');
      list.innerHTML = '';
      groups.forEach(g => {
        const li = document.createElement('li');
        if (g.id === selectedGroupId) li.classList.add('active');
        li.innerHTML = '<span class="name">' + esc(g.name) + '</span><button class="del-group" title="Delete group">&times;</button>';
        li.querySelector('.name').onclick = () => selectGroup(g.id);
        li.querySelector('.del-group').onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('Delete group "' + g.name + '"?')) return;
          await api('/admin/api/groups/' + g.id, { method: 'DELETE' });
          if (selectedGroupId === g.id) { selectedGroupId = null; showNoSelection(); }
          loadGroups();
        };
        list.appendChild(li);
      });
    } catch {}
  }

  $('#new-group-btn').onclick = async () => {
    const name = prompt('Group name:');
    if (!name) return;
    const g = await api('/admin/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
    await loadGroups();
    selectGroup(g.id);
  };

  function showNoSelection() {
    $('#no-selection').classList.remove('hidden');
    $('#group-detail').classList.add('hidden');
  }

  async function selectGroup(id) {
    selectedGroupId = id;
    $('#no-selection').classList.add('hidden');
    $('#group-detail').classList.remove('hidden');
    $('#note-editor').classList.add('hidden');
    editingNoteId = null;

    // Highlight in sidebar
    document.querySelectorAll('#group-list li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('#group-list li').forEach(li => {
      if (li.querySelector('.name') && li.querySelector('.name').onclick) {
        // Re-check after load
      }
    });
    await loadGroups();
    await loadGroupDetail(id);
  }

  async function loadGroupDetail(id) {
    // Load devices
    try {
      const devices = await api('/admin/api/groups/' + id + '/devices');
      groupDevices = devices.map(d => d.device_id);
      renderDevices();
    } catch {}

    // Load notes
    try {
      const notes = await api('/admin/api/groups/' + id + '/notes');
      renderNotes(notes);
    } catch {}
  }

  function renderDevices() {
    const container = $('#device-tags');
    container.innerHTML = '';
    groupDevices.forEach(did => {
      const tag = document.createElement('span');
      tag.className = 'device-tag';
      tag.innerHTML = esc(did.slice(0, 12) + '...') + '<button title="Remove">&times;</button>';
      tag.querySelector('button').onclick = async () => {
        await api('/admin/api/groups/' + selectedGroupId + '/devices/' + did, { method: 'DELETE' });
        await loadGroupDetail(selectedGroupId);
      };
      container.appendChild(tag);
    });
    if (groupDevices.length === 0) {
      container.innerHTML = '<span class="empty">No devices</span>';
    }

    // Populate dropdown
    const sel = $('#device-select');
    sel.innerHTML = '<option value="">Add device...</option>';
    allDevices.forEach(d => {
      if (!groupDevices.includes(d.device_id)) {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = d.device_id.slice(0, 20) + (d.device_id.length > 20 ? '...' : '');
        sel.appendChild(opt);
      }
    });
  }

  $('#add-device-btn').onclick = async () => {
    const did = $('#device-select').value;
    if (!did) return;
    await api('/admin/api/groups/' + selectedGroupId + '/devices', { method: 'POST', body: JSON.stringify({ device_id: did }) });
    await loadGroupDetail(selectedGroupId);
  };

  function renderNotes(notes) {
    const container = $('#notes-list');
    container.innerHTML = '';
    if (notes.length === 0) {
      container.innerHTML = '<span class="empty">No notes</span>';
      return;
    }
    notes.forEach(n => {
      const row = document.createElement('div');
      row.className = 'note-row';
      row.innerHTML = '<span class="note-title">' + esc(n.title || '(untitled)') + '</span>' +
        '<div class="actions">' +
        '<button class="btn btn-sm btn-outline edit-btn">Edit</button>' +
        '<button class="btn btn-sm btn-danger del-btn">Delete</button>' +
        '</div>';
      row.querySelector('.note-title').onclick = () => openNoteEditor(n);
      row.querySelector('.edit-btn').onclick = () => openNoteEditor(n);
      row.querySelector('.del-btn').onclick = async () => {
        if (!confirm('Delete this note?')) return;
        await api('/admin/api/groups/' + selectedGroupId + '/notes/' + n.id, { method: 'DELETE' });
        await loadGroupDetail(selectedGroupId);
      };
      container.appendChild(row);
    });
  }

  $('#new-note-btn').onclick = () => openNoteEditor(null);

  function openNoteEditor(note) {
    editingNoteId = note ? note.id : null;
    $('#note-editor-title-label').textContent = note ? 'Edit Note' : 'New Note';
    $('#note-title').value = note ? (note.title || '') : '';
    $('#note-content').value = note ? (note.content || '') : '';
    $('#note-editor').classList.remove('hidden');
    $('#note-title').focus();
  }

  $('#cancel-note-btn').onclick = () => {
    $('#note-editor').classList.add('hidden');
    editingNoteId = null;
  };

  $('#save-note-btn').onclick = async () => {
    const title = $('#note-title').value.trim();
    const content = $('#note-content').value.trim();
    if (editingNoteId) {
      await api('/admin/api/groups/' + selectedGroupId + '/notes/' + editingNoteId, { method: 'PUT', body: JSON.stringify({ title, content }) });
    } else {
      await api('/admin/api/groups/' + selectedGroupId + '/notes', { method: 'POST', body: JSON.stringify({ title, content }) });
    }
    $('#note-editor').classList.add('hidden');
    editingNoteId = null;
    await loadGroupDetail(selectedGroupId);
  };

  // Update group name on blur
  let nameTimeout = null;
  $('#group-name').addEventListener('input', () => {
    clearTimeout(nameTimeout);
    nameTimeout = setTimeout(async () => {
      // No dedicated rename endpoint — just a UX placeholder; groups are named at creation
    }, 500);
  });

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
</script>
</body>
</html>`;
}
