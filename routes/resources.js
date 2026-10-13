const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError, validId, userFields, taskFields } = require('../lib/validation');
const { collectionQuery, projection } = require('../lib/query');
const router = express.Router();
const reply = (res, status, data, message = 'OK') => res.status(status).json({ message, data });

async function existing(Model, id, session) {
    if (!validId(id)) throw new ApiError(404, `${Model.modelName} not found.`);
    const doc = await Model.findById(id).session(session || null);
    if (!doc) throw new ApiError(404, `${Model.modelName} not found.`);
    return doc;
}

// Atlas supports transactions: validation failures and write failures both roll back.
async function transaction(work) {
    return mongoose.connection.transaction(work);
}

async function saveUser(body, id, session) {
    const user = id ? await existing(User, id, session) : new User();
    const fields = userFields(body);
    const duplicate = await User.findOne({ email: fields.email, _id: { $ne: user._id } }).session(session);
    if (duplicate) throw new ApiError(400, 'Email is already used by another user.');
    const tasks = await Task.find({ _id: { $in: fields.pendingTasks } }).session(session);
    if (tasks.length !== fields.pendingTasks.length) throw new ApiError(404, 'A referenced task was not found.');
    if (tasks.some(task => task.completed)) throw new ApiError(400, 'Completed tasks cannot be included in pendingTasks.');
    const userId = user._id.toString();
    const removed = user.pendingTasks.filter(taskId => !fields.pendingTasks.includes(taskId));
    user.set(fields);
    await user.save({ session });
    await Task.updateMany({ _id: { $in: removed }, assignedUser: userId },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
    // Remove transferred tasks from every previous owner's list.
    await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: fields.pendingTasks } },
        { $pull: { pendingTasks: { $in: fields.pendingTasks } } }, { session });
    await Task.updateMany({ _id: { $in: fields.pendingTasks } },
        { $set: { assignedUser: userId, assignedUserName: user.name } }, { session });
    // Completed tasks remain assigned and also follow a user's name change.
    await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: user.name } }, { session });
    return user.toObject();
}

async function saveTask(body, id, session) {
    const task = id ? await existing(Task, id, session) : new Task();
    const fields = taskFields(body);
    if (fields.assignedUser) {
        const owner = await existing(User, fields.assignedUser, session);
        if (fields.assignedUserName !== undefined && fields.assignedUserName !== owner.name) {
            throw new ApiError(400, 'assignedUserName must match the assigned user.');
        }
        fields.assignedUserName = owner.name;
    } else fields.assignedUserName = 'unassigned';
    task.set(fields);
    await task.save({ session });
    const taskId = task._id.toString();
    await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session });
    if (task.assignedUser && !task.completed) {
        await User.updateOne({ _id: task.assignedUser }, { $addToSet: { pendingTasks: taskId } }, { session });
    }
    return task.toObject();
}

for (const [path, Model, save, defaultLimit] of [
    ['users', User, saveUser, 0], ['tasks', Task, saveTask, 100]
]) {
    router.get(`/${path}`, async (req, res) => {
        const q = collectionQuery(req.query, defaultLimit);
        const data = q.count
            ? await Model.countDocuments(q.where)
            : await Model.find(q.where).sort(q.sort).select(q.select).skip(q.skip).limit(q.limit).lean();
        reply(res, 200, data);
    });
    router.get(`/${path}/:id`, async (req, res) => {
        if (!validId(req.params.id)) throw new ApiError(404, `${Model.modelName} not found.`);
        const data = await Model.findById(req.params.id).select(projection(req.query)).lean();
        if (!data) throw new ApiError(404, `${Model.modelName} not found.`);
        reply(res, 200, data);
    });
    router.post(`/${path}`, async (req, res) => {
        const data = await transaction(session => save(req.body, null, session));
        reply(res, 201, data, `${Model.modelName} created.`);
    });
    router.put(`/${path}/:id`, async (req, res) => {
        const data = await transaction(session => save(req.body, req.params.id, session));
        reply(res, 200, data, `${Model.modelName} updated.`);
    });
    router.delete(`/${path}/:id`, async (req, res) => {
        await transaction(async session => {
            const doc = await existing(Model, req.params.id, session);
            if (Model === User) {
                await Task.updateMany({ assignedUser: doc._id.toString() },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
            } else {
                await User.updateMany({ pendingTasks: doc._id.toString() },
                    { $pull: { pendingTasks: doc._id.toString() } }, { session });
            }
            await doc.deleteOne({ session });
        });
        res.status(204).end();
    });
}
module.exports = router;
