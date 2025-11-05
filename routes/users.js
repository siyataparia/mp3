// routes/users.js
var User = require('../models/user');
var Task = require('../models/task');

function parseJSON(q) {
  if (!q) return undefined;
  try { return JSON.parse(q); } catch (e) { return undefined; }
}

module.exports = function (router) {
  // GET /api/users (supports where/sort/select/skip/limit/count)
  router.get('/users', async function (req, res, next) {
    try {
      const where  = parseJSON(req.query.where)  || {};
      const sort   = parseJSON(req.query.sort);
      const select = parseJSON(req.query.select);
      const skip   = req.query.skip  ? Number(req.query.skip)  : 0;
      const limit  = req.query.limit ? Number(req.query.limit) : undefined; // unlimited by default for users

      if (String(req.query.count) === 'true') {
        const n = await User.countDocuments(where);
        return res.status(200).json({ message: 'OK', data: n });
      }

      let q = User.find(where);
      if (select) q = q.select(select);
      if (sort)   q = q.sort(sort);
      if (skip)   q = q.skip(skip);
      if (typeof limit === 'number') q = q.limit(limit);

      const docs = await q.exec();
      res.status(200).json({ message: 'OK', data: docs });
    } catch (err) { next(err); }
  });

  // POST /api/users
  router.post('/users', async function (req, res, next) {
    try {
      const { name, email } = req.body || {};
      if (!name || !email) {
        return res.status(400).json({ message: 'Name and email are required', data: null });
      }
      const emailLower = String(email).toLowerCase();
      const exists = await User.findOne({ email: emailLower });
      if (exists) {
        return res.status(400).json({ message: 'A user with that email already exists', data: null });
      }
      const user = await User.create({ name, email: emailLower, pendingTasks: [] });
      res.status(201).json({ message: 'User created', data: user });
    } catch (err) { next(err); }
  });

  // GET /api/users/:id (supports ?select={...})
  router.get('/users/:id', async function (req, res, next) {
    try {
      const select = parseJSON(req.query.select);
      const user = await User.findById(req.params.id).select(select || {});
      if (!user) return res.status(404).json({ message: 'User not found', data: null });
      res.status(200).json({ message: 'OK', data: user });
    } catch (err) { next(err); }
  });

  // PUT /api/users/:id  (replace; enforce email uniqueness; sync pendingTasks two-way)
  router.put('/users/:id', async function (req, res, next) {
    try {
      const { name, email, pendingTasks } = req.body || {};
      if (!name || !email) {
        return res.status(400).json({ message: 'Name and email are required', data: null });
      }

      const emailLower = String(email).toLowerCase();
      const conflict = await User.findOne({ email: emailLower, _id: { $ne: req.params.id } });
      if (conflict) {
        return res.status(400).json({ message: 'Another user already uses that email', data: null });
      }

      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found', data: null });

      // Update basic fields
      user.name  = name;
      user.email = emailLower;

      // Two-way sync ONLY when pendingTasks is provided (spec requirement)
      if (Array.isArray(pendingTasks)) {
        const desired = new Set(pendingTasks.map(String));

        // Unassign tasks currently assigned to this user but not in desired
        const currentlyAssigned = await Task.find({ assignedUser: String(user._id) }).select('_id');
        const toUnassign = currentlyAssigned
          .map(t => String(t._id))
          .filter(id => !desired.has(id));

        if (toUnassign.length) {
          await Task.updateMany(
            { _id: { $in: toUnassign } },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
          );
        }

        // Assign each desired task to this user, mark as pending (completed=false)
        for (const tid of desired) {
          const t = await Task.findById(tid);
          if (!t) continue; // skip bad ids silently
          t.assignedUser = String(user._id);
          t.assignedUserName = user.name;
          t.completed = false;
          await t.save();
        }

        // Recompute pendingTasks to be all incomplete tasks assigned to this user
        const newPending = await Task.find({ assignedUser: String(user._id), completed: false }).select('_id');
        user.pendingTasks = newPending.map(t => String(t._id));
      }

      await user.save();
      res.status(200).json({ message: 'User updated', data: user });
    } catch (err) { next(err); }
  });

  // DELETE /api/users/:id  (unassign their tasks, then delete)
  router.delete('/users/:id', async function (req, res, next) {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found', data: null });

      await Task.updateMany(
        { assignedUser: String(user._id) },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
      );

      await User.findByIdAndDelete(req.params.id);
      res.status(200).json({ message: 'User deleted', data: null });
    } catch (err) { next(err); }
  });
};
