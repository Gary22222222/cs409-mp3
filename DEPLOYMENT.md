# Run and submit

1. Use Node 24 LTS and run `npm ci`.
2. Copy `.env.example` to `.env` and replace `MONGODB_URI` with your Atlas connection string. Do not commit `.env`.
3. In Atlas, allow the network access required by the assignment and ensure the database user has read/write access. The API uses transactions, so use Atlas or a MongoDB replica set, not a standalone database.
4. Run `npm start`. The API is at `http://localhost:3000/api`.
5. Run `npm test` for integration tests. These use a separate, temporary MongoDB replica set and never connect to your Atlas database. The first run downloads a MongoDB binary.
6. Push the code to your own repository. In Render, create a Blueprint from `render.yaml`, or a Node web service with build command `npm ci` and start command `npm start`. Set `MONGODB_URI` in Render and use Node 24.
7. Open the deployed `/api` URL, then set `API_URL` in `submit.js` to the deployment's base URL and run `npm run submit`.
8. Submit the repository and deployment links through the form linked in README. The self-check does not submit the assignment.

The course's LLM policy requires submitting your chat logs with source code and answering the LLM survey. Declare ChatGPT/Codex assistance and any other sources used.
