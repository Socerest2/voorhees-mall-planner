/* Shared-plan sync over Supabase's REST API.

   Five people editing one drawing, so the merge is per item, not per document:
   every item carries a uid and the timestamp of its last edit, and deletions
   leave a tombstone. Last edit to a given item wins; nobody's work is lost
   because someone else saved a second later. Plain fetch and a poll — no
   websocket, no library, and it degrades to local-only when unconfigured. */

(function () {
  const C = window.PLANNER_CONFIG || {};
  const on = !!(C.url && C.key);

  const head = {
    apikey: C.key,
    Authorization: 'Bearer ' + C.key,
    'Content-Type': 'application/json',
  };
  const rest = (path, opts = {}) =>
    fetch(C.url.replace(/\/$/, '') + '/rest/v1/' + path, {
      ...opts, headers: { ...head, ...(opts.headers || {}) },
    }).then(async r => {
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.status === 204 ? null : r.json();
    });

  /* Merge two plan docs. Each item: {uid, at, ...}. Tombstones: {uid: at}. */
  function merge(a, b) {
    const items = new Map(), dead = { ...(a.deleted || {}), ...(b.deleted || {}) };
    for (const [k, t] of Object.entries(a.deleted || {}))
      if ((b.deleted || {})[k] > t) dead[k] = (b.deleted || {})[k];
    for (const it of [...(a.items || []), ...(b.items || [])]) {
      if (!it.uid) continue;
      const prev = items.get(it.uid);
      if (!prev || (it.at || 0) > (prev.at || 0)) items.set(it.uid, it);
    }
    for (const [uid, t] of Object.entries(dead)) {
      const it = items.get(uid);
      if (it && (it.at || 0) <= t) items.delete(uid);
      else if (it) delete dead[uid];          // edited after deletion: it lives
    }
    return { items: [...items.values()], deleted: dead };
  }

  const q = p => encodeURIComponent(p);

  window.Sync = {
    on,
    planId: C.planId || 'voorhees',
    pollMs: Math.max(2, C.pollSeconds || 6) * 1000,
    merge,

    async pull() {
      if (!on) return null;
      const rows = await rest(
        `plans?id=eq.${q(this.planId)}&select=doc,updated_at,updated_by`);
      if (!rows.length) {
        await rest('plans', { method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ id: this.planId }) });
        return { doc: { items: [], deleted: {} }, updated_at: null, updated_by: null };
      }
      return rows[0];
    },

    /* Merge local work into whatever is on the server, write it back, and
       (when `label` is given) keep a restorable snapshot of the result. */
    async push(local, by, label) {
      if (!on) return local;
      const cur = await this.pull();
      const doc = merge(cur ? cur.doc : { items: [] }, local);
      await rest(`plans?id=eq.${q(this.planId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ doc, updated_at: new Date().toISOString(), updated_by: by }),
      });
      if (label !== undefined)
        await rest('plan_versions', { method: 'POST',
          body: JSON.stringify({ plan_id: this.planId, doc, label: label || null, saved_by: by }) });
      return doc;
    },

    async versions(limit = 25) {
      if (!on) return [];
      return rest(`plan_versions?plan_id=eq.${q(this.planId)}` +
        `&select=id,label,saved_by,saved_at&order=saved_at.desc&limit=${limit}`);
    },

    async version(id) {
      if (!on) return null;
      const r = await rest(`plan_versions?id=eq.${id}&select=doc`);
      return r.length ? r[0].doc : null;
    },
  };
})();
