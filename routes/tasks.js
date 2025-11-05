// routes/tasks.js
var Task = require('../models/task');
var User = require('../models/user');

function parseJSON(q) {
  if (!q) return undefined;
  try { return JSON.parse(q); } catch { return undefined; }
}

module.exports = function (router) {
  // GET /api/tasks (supports where/sort/select/skip/limit/count; default limit=100)
  router.get('/tasks', async function (req, res, next) {
    try {
      const where  = parseJSON(req.query.where)  || {};
      const sort   = parseJSON(req.query.sort);
      const select = parseJSON(req.query.select);
      const skip   = req.query.skip  ? Number(req.query.skip)  : 0;
      const limit  = req.query.limit ? Number(req.query.limit) : 100; // default 100

      if (String(req.query.count) === 'true') {
        const n = await Task.countDocuments(where);
        return res.status(200).json({ message: 'OK', data: n });
      }

      let q = Task.find(where);
      if (select) q = q.select(select);
      if (sort)   q = q.sort(sort);
      if (skip)   q = q.skip(skip);
      if (limit)  q = q.limit(limit);

      const docs = await q.exec();
      res.status(200).json({ message: 'OK', data: docs });
    } catch (err) { next(err); }
  });

  // POST /api/tasks
  router.post('/tasks', async function (req, res, next) {
    try {
      const body = req.body || {};
      if (!body.name || !body.deadline) {
        return res.status(400).json({ message: 'Name and deadline are required', data: null });
      }

      let assignedUser = String(body.assignedUser || '');
      let assignedUserName = 'unassigned';
      let assignedUserDoc = null;

      if (assignedUser) {
        assignedUserDoc = await User.findById(assignedUser);
        if (!assignedUserDoc) {
          return res.status(400).json({ message: 'Assigned user not found', data: null });
        }
        assignedUserName = body.assignedUserName || assignedUserDoc.name;
      }

      const task = await Task.create({
        name: body.name,
        description: body.description || '',
        deadline: body.deadline,
        completed: !!body.completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUser ? assignedUserName : 'unassigned'
      });

      // Two-way: add to pendingTasks if assigned and not completed
      if (assignedUser && !task.completed) {
        await User.findByIdAndUpdate(assignedUser, { $addToSet: { pendingTasks: String(task._id) } });
      }

      res.status(201).json({ message: 'Task created', data: task });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:id (supports ?select={...})
  router.get('/tasks/:id', async function (req, res, next) {
    try {
      const select = parseJSON(req.query.select);
      const task = await Task.findById(req.params.id).select(select || {});
      if (!task) return res.status(404).json({ message: 'Task not found', data: null });
      res.status(200).json({ message: 'OK', data: task });
    } catch (err) { next(err); }
  });

  // PUT /api/tasks/:id (replace; ensure two-way consistency)
  router.put('/tasks/:id', async function (req, res, next) {
    try {
      const body = req.body || {};
      if (!body.name || !body.deadline) {
        return res.status(400).json({ message: 'Name and deadline are required', data: null });
      }

      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ message: 'Task not found', data: null });

      const prevUser = String(task.assignedUser || '');
      const prevCompleted = !!task.completed;

      // Validate new assignment
      let newAssignedUser = String(body.assignedUser || '');
      let newAssignedUserName = 'unassigned';
      let newAssignedDoc = null;

      if (newAssignedUser) {
        newAssignedDoc = await User.findById(newAssignedUser);
        if (!newAssignedDoc) {
          return res.status(400).json({ message: 'Assigned user not found', data: null });
        }
        newAssignedUserName = body.assignedUserName || newAssignedDoc.name;
      }

      // Apply replacement
      task.name = body.name;
      task.description = body.description || '';
      task.deadline = body.deadline;
      task.completed = !!body.completed;
      task.assignedUser = newAssignedUser;
      task.assignedUserName = newAssignedUser ? newAssignedUserName : 'unassigned';
      await task.save();

      // Two-way adjustments
      const taskIdStr = String(task._id);

      // If assignment changed, remove from old, add to new (if incomplete)
      if (prevUser && prevUser !== newAssignedUser) {
        await User.findByIdAndUpdate(prevUser, { $pull: { pendingTasks: taskIdStr } });
      }
      if (newAssignedUser) {
        if (!task.completed) {
          await User.findByIdAndUpdate(newAssignedUser, { $addToSet: { pendingTasks: taskIdStr } });
        } else {
          await User.findByIdAndUpdate(newAssignedUser, { $pull: { pendingTasks: taskIdStr } });
        }
      }

      // If only completion status changed with same assignee
      if (prevUser && prevUser === newAssignedUser && prevCompleted !== task.completed) {
        await User.findByIdAndUpdate(prevUser, task.completed
          ? { $pull: { pendingTasks: taskIdStr } }
          : { $addToSet: { pendingTasks: taskIdStr } }
        );
      }

      res.status(200).json({ message: 'Task updated', data: task });
    } catch (err) { next(err); }
  });

  // DELETE /api/tasks/:id (remove from assigned user's pendingTasks)
  router.delete('/tasks/:id', async function (req, res, next) {
    try {
      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ message: 'Task not found', data: null });

      const assignedUser = String(task.assignedUser || '');
      await Task.findByIdAndDelete(req.params.id);

      if (assignedUser) {
        await User.findByIdAndUpdate(assignedUser, { $pull: { pendingTasks: String(task._id) } });
      }

      res.status(200).json({ message: 'Task deleted', data: null });
    } catch (err) { next(err); }
  });
};
