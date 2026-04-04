# 📚 Study Timeline

A web app that turns raw assignment deadlines into a visual, day-by-day study timeline with automatically generated subtasks and milestone checkpoints.

## Features

- ✅ Add assignments with title, course code, deadline, and estimated hours
- 🤖 AI-powered subtask generation via LLM
- 📅 Visual timeline with color-coded daily study targets
- ☑️ Interactive checkboxes to mark subtasks complete
- 📊 Real-time progress tracking
- 💾 SQLite persistence

## Tech Stack

- **Backend**: FastAPI (Python) + SQLite
- **Frontend**: React 18 + Vite
- **LLM**: Qwen Code API / DashScope / OpenRouter

## Quick Start

### 1. Set up the Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure LLM Access

Create `backend/.env` (copy from `.env.example`). Choose **one** option:

#### Option 1: Qwen Code API (from your course VM)

Deploy via Docker on your VM: [qwen-code-api deployment guide](https://github.com/inno-se-toolkit/qwen-code-api)

```env
LLM_API_BASE_URL=http://<your-vm-ip>:<port>
LLM_API_KEY=<from qwen-code-api .env.secret>
LLM_API_MODEL=coder-model
```

#### Option 2: DashScope API Key

Get a free key at [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/)

```env
DASHSCOPE_API_KEY=sk-xxxxx
```

#### Option 3: OpenRouter (free, no VPN needed from Russia)

Register at [openrouter.ai](https://openrouter.ai), get an API key:

```env
OPENROUTER_API_KEY=sk-or-xxxxx
```

#### No LLM configured?

The app still works — subtasks are generated algorithmically as a fallback.

### 3. Start the Backend

```bash
uvicorn main:app --reload
```

Backend runs at: `http://127.0.0.1:8000`

### 4. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at: `http://localhost:3000`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/assignments` | Create assignment + generate subtasks |
| `GET` | `/api/assignments` | List all assignments |
| `GET` | `/api/assignments/{id}` | Get assignment with subtasks |
| `PATCH` | `/api/subtasks/{id}` | Toggle subtask completion |
| `DELETE` | `/api/assignments/{id}` | Delete assignment |
| `GET` | `/api/health` | Health check |

## How It Works

1. **Input**: User enters assignment name, deadline, estimated hours, course code
2. **AI Generation**: Backend sends prompt to LLM to break assignment into 4-6 logical subtasks
3. **Scheduling**: Subtasks are distributed across available days before deadline
4. **Visualization**: Frontend renders a timeline with color-coded tasks
5. **Tracking**: User checks off subtasks, progress bar updates in real-time

## Fallback Mode

If no LLM provider is configured or the API is unavailable, the backend automatically generates basic subtasks algorithmically so the app always works.
