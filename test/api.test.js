const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { app } = require('../server');
const User = require('../models/user');
const Task = require('../models/task');
let mongo, server, base;
before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri());
    await Promise.all([User.init(), Task.init()]);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(async () => { await User.deleteMany({}); await Task.deleteMany({}); });
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});
async function request(method, path, body, status = 200) {
    const response = await fetch(base + path, { method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, JSON.stringify(payload));
    if (payload) {
        assert.equal(typeof payload.message, 'string');
        assert.ok(Object.hasOwn(payload, 'data'));
    }
    return payload?.data;
}
const user = (name, extra = {}) => request('POST', '/users', { name, email: `${name}@example.com`, ...extra }, 201);
const task = (name, extra = {}) => request('POST', '/tasks', { name, deadline: '2026-11-03', ...extra }, 201);
const getUser = id => request('GET', `/users/${id}`);
const getTask = id => request('GET', `/tasks/${id}`);

test('creation defaults, strict field validation, duplicate email and URL ID precedence', async () => {
    const a = await user('Alice', { dateCreated: '2000-01-01' });
    assert.deepEqual(a.pendingTasks, []);
    assert.ok(new Date(a.dateCreated).getFullYear() > 2000);
    const t = await task('Todo');
    assert.equal(t.completed, false);
    assert.equal(t.description, '');
    assert.equal(t.assignedUser, '');
    assert.equal(t.assignedUserName, 'unassigned');
    await request('POST', '/users', { name: 'B', email: a.email }, 400);
    for (const body of [{}, { name: 1, email: 'x' }, { name: 'A', email: 'x', pendingTasks: 'bad' },
        { name: 'A', email: 'x', pendingTasks: ['bad'] }]) await request('POST', '/users', body, 400);
    for (const body of [{}, { name: 'x', deadline: 'bad' }, { name: 'x', deadline: '2026-01-01', completed: 'false' },
        { name: 'x', deadline: '2026-01-01', assignedUser: 'bad' },
        { name: 'x', deadline: '2026-01-01', description: 1 }]) await request('POST', '/tasks', body, 400);
    for (const path of ['/users/bad', '/tasks/bad', '/users/aaaaaaaaaaaaaaaaaaaaaaaa', '/tasks/aaaaaaaaaaaaaaaaaaaaaaaa']) {
        await request('PUT', path, {}, 404);
        await request('GET', path, undefined, 404);
        await request('DELETE', path, undefined, 404);
    }
});

test('assignment transfer, completion, reopening and replacement defaults', async () => {
    const a = await user('Alice'), b = await user('Bob');
    const t = await task('Todo', { assignedUser: a._id });
    assert.equal(t.assignedUserName, a.name);
    assert.deepEqual((await getUser(a._id)).pendingTasks, [t._id]);
    const put = extra => request('PUT', `/tasks/${t._id}`, { name: 'Changed', deadline: '2026-12-01', ...extra });
    await put({ assignedUser: b._id });
    assert.deepEqual((await getUser(a._id)).pendingTasks, []);
    assert.deepEqual((await getUser(b._id)).pendingTasks, [t._id]);
    await put({ assignedUser: b._id, completed: true });
    assert.deepEqual((await getUser(b._id)).pendingTasks, []);
    await put({ assignedUser: a._id, completed: true });
    assert.deepEqual((await getUser(a._id)).pendingTasks, []);
    await put({ assignedUser: a._id, completed: false });
    assert.deepEqual((await getUser(a._id)).pendingTasks, [t._id]);
    const replaced = await put({});
    assert.equal(replaced.dateCreated, t.dateCreated);
    assert.equal(replaced.assignedUser, '');
    assert.deepEqual((await getUser(a._id)).pendingTasks, []);
});

test('user replacement moves tasks, renames completed assignments and clears omitted lists', async () => {
    const a = await user('Alice'), b = await user('Bob');
    const t = await task('Pending', { assignedUser: a._id });
    const completed = await task('Done', { assignedUser: b._id, completed: true });
    const updated = await request('PUT', `/users/${b._id}`, { name: 'Robert', email: b.email, pendingTasks: [t._id] });
    assert.equal(updated.dateCreated, b.dateCreated);
    assert.deepEqual((await getUser(a._id)).pendingTasks, []);
    assert.equal((await getTask(t._id)).assignedUserName, 'Robert');
    assert.equal((await getTask(completed._id)).assignedUserName, 'Robert');
    await request('PUT', `/users/${b._id}`, { name: 'Bobby', email: b.email });
    assert.equal((await getTask(t._id)).assignedUser, '');
    assert.equal((await getTask(completed._id)).assignedUserName, 'Bobby');
    const c = await user('Charlie', { pendingTasks: [t._id] });
    assert.equal((await getTask(t._id)).assignedUser, c._id);
});

test('failed writes do not mutate resources or their references', async () => {
    const a = await user('Alice'), b = await user('Bob');
    const t = await task('Todo', { assignedUser: a._id });
    const completed = await task('Done', { completed: true });
    const beforeUsers = await request('GET', '/users');
    const beforeTasks = await request('GET', '/tasks');
    await request('PUT', `/users/${b._id}`, { name: 'Invalid', email: b.email, pendingTasks: [t._id, completed._id] }, 400);
    await request('PUT', `/users/${b._id}`, { name: 'Invalid', email: a.email, pendingTasks: [t._id] }, 400);
    await request('POST', '/users', { name: 'X', email: 'x', pendingTasks: [t._id, 'aaaaaaaaaaaaaaaaaaaaaaaa'] }, 404);
    await request('PUT', `/tasks/${t._id}`, { name: 'Invalid', deadline: '2026-01-01', assignedUser: b._id, assignedUserName: 'Wrong' }, 400);
    await request('PUT', `/tasks/${t._id}`, { name: 'Invalid', deadline: '2026-01-01', assignedUser: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, 404);
    assert.deepEqual(await request('GET', '/users'), beforeUsers);
    assert.deepEqual(await request('GET', '/tasks'), beforeTasks);
    // Force an unexpected failure after the user write and confirm transaction rollback.
    const original = Task.updateMany;
    Task.updateMany = async () => { throw new Error('simulated write failure'); };
    try { await request('PUT', `/users/${b._id}`, { name: 'Changed', email: b.email, pendingTasks: [t._id] }, 500); }
    finally { Task.updateMany = original; }
    assert.deepEqual(await request('GET', '/users'), beforeUsers);
    assert.deepEqual(await request('GET', '/tasks'), beforeTasks);
});

test('query combinations, count, pagination, projections and invalid JSON', async () => {
    const a = await user('Alice');
    await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `Task${i.toString().padStart(3, '0')}`,
        deadline: new Date('2026-11-03'), completed: i % 2 === 0 })));
    assert.equal((await request('GET', '/tasks')).length, 100);
    assert.equal((await request('GET', '/tasks?limit=0')).length, 105);
    const query = new URLSearchParams({ where: JSON.stringify({ completed: true }), sort: JSON.stringify({ name: -1 }),
        select: JSON.stringify({ name: 1, _id: 0 }), skip: '1', limit: '2' });
    assert.deepEqual(await request('GET', `/tasks?${query}`), [{ name: 'Task102' }, { name: 'Task100' }]);
    query.set('count', 'true');
    assert.equal(await request('GET', `/tasks?${query}`), 53);
    assert.deepEqual(await request('GET', '/users?where=%7B%22name%22%3A%22Missing%22%7D'), []);
    assert.deepEqual(await request('GET', `/users/${a._id}?select=%7B%22name%22%3A1%2C%22_id%22%3A0%7D&where=bad&count=bad`), { name: 'Alice' });
    for (const q of ['where=bad', 'sort=[]', 'select={"name":1,"email":0}', 'skip=-1', 'limit=1.2', 'count=1']) {
        await request('GET', '/tasks?' + q, undefined, 400);
    }
});

test('deletion cleans pending and completed references and CORS supports preflight', async () => {
    const a = await user('Alice');
    const pending = await task('Pending', { assignedUser: a._id });
    const done = await task('Done', { assignedUser: a._id, completed: true });
    await request('DELETE', `/tasks/${pending._id}`, undefined, 204);
    assert.deepEqual((await getUser(a._id)).pendingTasks, []);
    await request('GET', `/tasks/${pending._id}`, undefined, 404);
    await request('DELETE', `/users/${a._id}`, undefined, 204);
    assert.equal((await getTask(done._id)).assignedUser, '');
    assert.equal((await getTask(done._id)).assignedUserName, 'unassigned');
    await request('GET', `/users/${a._id}`, undefined, 404);
    await request('OPTIONS', '/tasks', undefined, 204);
    await request('GET', '/missing', undefined, 404);
});
