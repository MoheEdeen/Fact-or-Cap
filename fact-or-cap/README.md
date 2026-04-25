# Real or Fake News Game

A real-time multiplayer game where players guess whether a political headline is **real** or **AI-generated**.

---

## Features

- Mix of real and AI-generated news
- Random **Manipulator** each round
- Manipulator knows the truth and tries to mislead
- Citizens vote **REAL** or **FAKE**
- Live vote tracking
- Automatic timers, reveal, and next rounds
- Score system + leaderboard

---

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + Socket.IO
- Python: Pandas + OpenAI API
- Dataset: News Category Dataset

---

## Setup

### 1. Install everything

```bash
npm install
cd server
npm install
pip install pandas python-dotenv openai
```

---

### 2. Environment variables

Create `server/.env`:

```env
GPT_API_KEY=your_openai_api_key
PYTHON_CMD=py
ROUND_TIME_SECONDS=30
REVEAL_TIME_SECONDS=6
```

---

### 3. Required files (inside `/server`)

```
get_runner.py
generate_fake.py
News_Category_Dataset_v3.json
.env
server.js
```

---

### 4. Run the app

```bash
npm run server
npm run dev
```

---

## How the Game Works

1. Players join a room
2. Game starts
3. Each round:
   - One random player = **Manipulator**
   - First half of rounds = real news
   - Second half = AI-generated
   - Manipulator sees the truth
4. Citizens vote
5. Reveal happens:
   - Manipulator can reveal early
   - OR auto reveal after timer
6. Scores update:
   - Citizens get points for correct votes
   - Manipulator gets points for fooling people
7. Next round starts automatically

---

## Rules

- Manipulator **cannot vote**
- Only manipulator can manually reveal
- Votes only count from citizens
- Game auto-progresses

---

## Scripts

```bash
npm run dev
npm run server
```

---

## Notes

- Make sure dataset is in `/server`
- Make sure `.env` key is correct
- Python must be available as `py` or `python`

---

## License

MIT
