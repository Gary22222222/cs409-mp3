class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new ApiError(400, message); };
const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
function string(body, key, required = false, fallback = '') {
    if (body[key] === undefined && !required) return fallback;
    if (typeof body[key] !== 'string' || (required && !body[key].trim())) {
        fail(`${key} must be ${required ? 'a non-empty' : 'a'} string.`);
    }
    return required ? body[key].trim() : body[key];
}
function validateBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be an object.');
}
function userFields(body) {
    validateBody(body);
    const name = string(body, 'name', true);
    const email = string(body, 'email', true);
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks) || !pendingTasks.every(validId)) fail('pendingTasks must be a list of valid task IDs.');
    return { name, email, pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))] };
}
function taskFields(body) {
    validateBody(body);
    const name = string(body, 'name', true);
    const description = string(body, 'description');
    if (typeof body.deadline !== 'string' || !body.deadline.trim() || !Number.isFinite(Date.parse(body.deadline))) {
        fail('deadline must be a valid date string.');
    }
    const completed = body.completed === undefined ? false : body.completed;
    if (typeof completed !== 'boolean') fail('completed must be a boolean.');
    const assignedUser = string(body, 'assignedUser');
    if (assignedUser && !validId(assignedUser)) fail('assignedUser must be a valid user ID or an empty string.');
    const assignedUserName = body.assignedUserName === undefined ? undefined : string(body, 'assignedUserName');
    if (!assignedUser && assignedUserName !== undefined && assignedUserName !== 'unassigned') {
        fail('An unassigned task must have assignedUserName "unassigned".');
    }
    return { name, description, deadline: new Date(body.deadline), completed,
        assignedUser: assignedUser.toLowerCase(), assignedUserName };
}
module.exports = { ApiError, fail, validId, userFields, taskFields };
