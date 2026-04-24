import http from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT ?? 3001);
const ROUND_TIME_SECONDS = Number(process.env.ROUND_TIME_SECONDS ?? 30);
const DEFAULT_TOTAL_ROUNDS = Number(process.env.DEFAULT_TOTAL_ROUNDS ?? 8);
const MIN_PLAYERS_TO_START = Number(process.env.MIN_PLAYERS_TO_START ?? 1);
const PYTHON_CMD = process.env.PYTHON_CMD ?? "py";
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const rooms = new Map();

function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    while (code.length < 5) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (rooms.has(code)) {
        return generateRoomCode();
    }

    return code;
}

function getPublicPlayer(player) {
    return {
        id: player.id,
        name: player.name,
        score: player.score,
        role: player.role,
        connected: player.connected,
    };
}

function serializeRoom(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        status: room.status,
        totalRounds: room.totalRounds,
        currentRoundNumber: room.currentRoundNumber,
        players: room.players.map(getPublicPlayer),
        currentRound: room.currentRound
            ? {
                roundNumber: room.currentRound.roundNumber,
                headline: room.currentRound.headline,
                description: room.currentRound.description,
                answer: room.currentRound.answer,
                startedAt: room.currentRound.startedAt,
                endsAt: room.currentRound.endsAt,
                revealed: room.currentRound.revealed,
                votes: room.currentRound.votes,
            }
            : null,
        finished: room.finished,
    };
}

function getPlayerInRoom(room, playerId) {
    return room.players.find((p) => p.id === playerId) ?? null;
}

function roomSummaryForClient(room, socketPlayerId) {
    const requester = getPlayerInRoom(room, socketPlayerId);

    return {
        code: room.code,
        hostId: room.hostId,
        status: room.status,
        totalRounds: room.totalRounds,
        currentRoundNumber: room.currentRoundNumber,
        players: room.players.map((player) => ({
            id: player.id,
            name: player.name,
            score: player.score,
            connected: player.connected,
            role: player.id === socketPlayerId || room.status !== "lobby" ? player.role : null,
        })),
        myRole: requester?.role ?? null,
        finished: room.finished,
    };
}

function emitRoomState(room) {
    for (const player of room.players) {
        io.to(player.socketId).emit("room_state", roomSummaryForClient(room, player.id));
    }
}

async function fetchPromptFromPython(mode) {
    const { stdout } = await execFileAsync(
        PYTHON_CMD,
        ["get_runner.py", "--json", "--mode", mode],
        {
            cwd: __dirname,
            timeout: 10000,
            maxBuffer: 512 * 1024,
        },
    );

    const parsed = JSON.parse(stdout.trim());

    if (!parsed.headline || !parsed.description) {
        throw new Error("Python prompt output missing headline or description.");
    }

    return {
        headline: String(parsed.headline).trim(),
        description: String(parsed.description).trim(),
        answer: parsed.answer === "fake" ? "fake" : "real",
    };
}

function pickManipulator(room) {
    const index = Math.floor(Math.random() * room.players.length);
    return room.players[index];


}

async function startRound(room) {
    if (room.players.length < MIN_PLAYERS_TO_START) {
        throw new Error(`Need at least ${MIN_PLAYERS_TO_START} players to start rounds.`);
    }

    if (room.currentRoundNumber >= room.totalRounds) {
        room.status = "finished";
        room.currentRound = null;
        room.finished = true;
        io.to(room.code).emit("game_finished", {
            code: room.code,
            leaderboard: room.players
                .map((p) => ({ id: p.id, name: p.name, score: p.score, role: p.role }))
                .sort((a, b) => b.score - a.score),
        });
        emitRoomState(room);
        return;
    }

    room.currentRoundNumber += 1;

    const manipulator = pickManipulator(room);
    room.players.forEach((player) => {
        player.role = player.id === manipulator.id ? "manipulator" : "citizen";
    });

    const halfPoint = Math.ceil(room.totalRounds / 2);
    const mode = room.currentRoundNumber <= halfPoint ? "real" : "fake";
    const prompt = await fetchPromptFromPython(mode);
    const now = Date.now();

    room.currentRound = {
        roundNumber: room.currentRoundNumber,
        headline: prompt.headline,
        description: prompt.description,
        answer: prompt.answer,
        startedAt: now,
        endsAt: now + ROUND_TIME_SECONDS * 1000,
        revealed: false,
        votes: {},
    };

    room.status = "in_round";

    for (const player of room.players) {
        const payload = {
            roundNumber: room.currentRound.roundNumber,
            totalRounds: room.totalRounds,
            headline: room.currentRound.headline,
            description: room.currentRound.description,
            roundEndsAt: room.currentRound.endsAt,
            myRole: player.role,
            truth: room.currentRound.answer,
        };

        io.to(player.socketId).emit("round_started", payload);
    }

    emitRoomState(room);
}

function revealRound(room) {
    if (!room.currentRound || room.currentRound.revealed) {
        return;
    }

    room.currentRound.revealed = true;

    const answer = room.currentRound.answer;
    const manipulator = room.players.find((player) => player.role === "manipulator");

    let fooledCount = 0;

    for (const player of room.players) {
        const vote = room.currentRound.votes[player.id];

        if (player.role === "citizen") {
            if (vote === answer) {
                player.score += 1;
            } else if (vote) {
                fooledCount += 1;
            }
        }
    }

    if (manipulator) {
        manipulator.score += fooledCount;
    }

    io.to(room.code).emit("round_revealed", {
        roundNumber: room.currentRound.roundNumber,
        answer,
        players: room.players.map((player) => ({
            id: player.id,
            name: player.name,
            role: player.role,
            vote: room.currentRound?.votes[player.id] ?? null,
            score: player.score,
            gotItRight:
                player.role === "citizen"
                    ? room.currentRound?.votes[player.id] === answer
                    : null,
        })),
        manipulatorFooledCount: fooledCount,
    });

    room.status = "reveal";
    emitRoomState(room);
}

app.get("/health", (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
});

app.get("/rooms/:code/state", (req, res) => {
    const room = rooms.get(req.params.code.toUpperCase());

    if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
    }

    res.json(serializeRoom(room));
});

io.on("connection", (socket) => {
    socket.on("create_room", ({ name, totalRounds = DEFAULT_TOTAL_ROUNDS } = {}, cb) => {
        try {
            const trimmedName = String(name ?? "").trim();
            if (!trimmedName) {
                throw new Error("Name is required.");
            }

            const code = generateRoomCode();
            const playerId = randomUUID();
            const host = {
                id: playerId,
                name: trimmedName,
                role: "citizen",
                score: 0,
                socketId: socket.id,
                connected: true,
            };

            const room = {
                code,
                hostId: playerId,
                status: "lobby",
                totalRounds: Math.max(1, Math.min(20, Number(totalRounds) || DEFAULT_TOTAL_ROUNDS)),
                currentRoundNumber: 0,
                players: [host],
                currentRound: null,
                finished: false,
            };

            rooms.set(code, room);
            socket.join(code);
            socket.data.playerId = playerId;
            socket.data.roomCode = code;

            cb?.({ ok: true, roomCode: code, playerId, room: roomSummaryForClient(room, playerId) });
            emitRoomState(room);
        } catch (error) {
            cb?.({ ok: false, error: error.message });
        }
    });

    socket.on("join_room", ({ roomCode, name } = {}, cb) => {
        try {
            const code = String(roomCode ?? "").trim().toUpperCase();
            const trimmedName = String(name ?? "").trim();

            if (!code || !trimmedName) {
                throw new Error("Room code and name are required.");
            }

            const room = rooms.get(code);
            if (!room) {
                throw new Error("Room not found.");
            }
            if (room.status !== "lobby") {
                throw new Error("Game already started.");
            }

            const playerId = randomUUID();
            const player = {
                id: playerId,
                name: trimmedName,
                role: "citizen",
                score: 0,
                socketId: socket.id,
                connected: true,
            };

            room.players.push(player);
            socket.join(code);
            socket.data.playerId = playerId;
            socket.data.roomCode = code;

            cb?.({ ok: true, roomCode: code, playerId, room: roomSummaryForClient(room, playerId) });
            io.to(code).emit("player_joined", { id: player.id, name: player.name });
            emitRoomState(room);
        } catch (error) {
            cb?.({ ok: false, error: error.message });
        }
    });

    socket.on("start_game", async (_payload, cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const playerId = socket.data.playerId;
            if (!roomCode || !playerId) {
                throw new Error("Player is not in a room.");
            }

            const room = rooms.get(roomCode);
            if (!room) {
                throw new Error("Room not found.");
            }
            if (room.hostId !== playerId) {
                throw new Error("Only host can start the game.");
            }
            if (room.status !== "lobby" && room.status !== "reveal") {
                throw new Error("Game cannot be started right now.");
            }

            await startRound(room);
            cb?.({ ok: true });
        } catch (error) {
            cb?.({ ok: false, error: error.message });
            const roomCode = socket.data.roomCode;
            if (roomCode) {
                io.to(roomCode).emit("server_error", { message: error.message });
            }
        }
    });

    socket.on("submit_vote", ({ vote } = {}, cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const playerId = socket.data.playerId;
            if (!roomCode || !playerId) {
                throw new Error("Player is not in a room.");
            }

            const room = rooms.get(roomCode);
            if (!room || !room.currentRound) {
                throw new Error("No active round.");
            }

            const normalizedVote = String(vote ?? "").toLowerCase();
            if (normalizedVote !== "real" && normalizedVote !== "fake") {
                throw new Error("Vote must be 'real' or 'fake'.");
            }

            const player = getPlayerInRoom(room, playerId);

            if (!player) {
                throw new Error("Player not found.");
            }

            if (player.role === "manipulator") {
                throw new Error("Manipulator does not vote.");
            }

            room.currentRound.votes[playerId] = normalizedVote;

            const citizenIds = room.players
                .filter((player) => player.role === "citizen")
                .map((player) => player.id);

            const submittedCitizenVotes = citizenIds.filter(
                (id) => room.currentRound.votes[id],
            ).length;

            io.to(roomCode).emit("vote_progress", {
                submittedCount: submittedCitizenVotes,
                totalPlayers: citizenIds.length,
            });

            cb?.({ ok: true });
        } catch (error) {
            cb?.({ ok: false, error: error.message });
        }
    });

    socket.on("reveal_round", (_payload, cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const playerId = socket.data.playerId;
            if (!roomCode || !playerId) {
                throw new Error("Player is not in a room.");
            }

            const room = rooms.get(roomCode);
            if (!room || !room.currentRound) {
                throw new Error("No active round.");
            }
            if (room.hostId !== playerId) {
                throw new Error("Only host can reveal round.");
            }

            revealRound(room);
            cb?.({ ok: true });
        } catch (error) {
            cb?.({ ok: false, error: error.message });
        }
    });

    socket.on("next_round", async (_payload, cb) => {
        try {
            const roomCode = socket.data.roomCode;
            const playerId = socket.data.playerId;
            if (!roomCode || !playerId) {
                throw new Error("Player is not in a room.");
            }

            const room = rooms.get(roomCode);
            if (!room) {
                throw new Error("Room not found.");
            }
            if (room.hostId !== playerId) {
                throw new Error("Only host can start the next round.");
            }
            if (room.status !== "reveal" && room.status !== "lobby") {
                throw new Error("Cannot start next round right now.");
            }

            await startRound(room);
            cb?.({ ok: true });
        } catch (error) {
            cb?.({ ok: false, error: error.message });
            const roomCode = socket.data.roomCode;
            if (roomCode) {
                io.to(roomCode).emit("server_error", { message: error.message });
            }
        }
    });

    socket.on("disconnect", () => {
        const roomCode = socket.data.roomCode;
        const playerId = socket.data.playerId;
        if (!roomCode || !playerId) {
            return;
        }

        const room = rooms.get(roomCode);
        if (!room) {
            return;
        }

        const player = getPlayerInRoom(room, playerId);
        if (!player) {
            return;
        }

        player.connected = false;

        if (room.hostId === player.id) {
            const nextHost = room.players.find((p) => p.id !== player.id && p.connected);
            if (nextHost) {
                room.hostId = nextHost.id;
            }
        }

        const connectedPlayers = room.players.filter((p) => p.connected);
        if (connectedPlayers.length === 0) {
            rooms.delete(room.code);
            return;
        }

        emitRoomState(room);
    });
});

server.listen(PORT, () => {
    console.log(`Socket server listening on http://localhost:${PORT}`);
});
