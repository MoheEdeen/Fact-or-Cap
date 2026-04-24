import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import "./App.css";

type Vote = "real" | "fake";

type PlayerState = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  role?: string | null;
};

type RoomState = {
  code: string;
  hostId: string;
  status: string;
  totalRounds: number;
  currentRoundNumber: number;
  players: PlayerState[];
  myRole: string | null;
  finished: boolean;
};

type RoundStartedPayload = {
  roundNumber: number;
  totalRounds: number;
  headline: string;
  description: string;
  roundEndsAt: number;
  myRole: string;
  truth: Vote | null;
};

type RoundRevealedPayload = {
  roundNumber: number;
  answer: Vote;
  players: Array<{
    id: string;
    name: string;
    role: string;
    vote: Vote | null;
    score: number;
    gotItRight: boolean | null;
  }>;
  manipulatorFooledCount: number;
};

type GameFinishedPayload = {
  code: string;
  leaderboard: Array<{
    id: string;
    name: string;
    score: number;
    role: string;
  }>;
};

function App() {
  const backendUrl = window.location.origin;
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [totalRounds, setTotalRounds] = useState(5);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [roundStarted, setRoundStarted] = useState<RoundStartedPayload | null>(
    null,
  );
  const [roundRevealed, setRoundRevealed] =
    useState<RoundRevealedPayload | null>(null);
  const [voteProgress, setVoteProgress] = useState("");
  const [error, setError] = useState("");
  const [gameFinished, setGameFinished] = useState<GameFinishedPayload | null>(
    null,
  );
  const [nowMs, setNowMs] = useState(Date.now());
  const [showCard, setShowCard] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const roundTransitionTimerRef = useRef<number | null>(null);

  const timerSeconds = useMemo(() => {
    if (!roundStarted?.roundEndsAt) {
      return 0;
    }
    return Math.max(0, Math.ceil((roundStarted.roundEndsAt - nowMs) / 1000));
  }, [roundStarted, nowMs]);

  const scoreboard = useMemo(() => {
    const players = roomState?.players ?? [];
    return [...players].sort((a, b) => b.score - a.score);
  }, [roomState]);

  const podiumBoard = useMemo(() => {
    if (gameFinished?.leaderboard) {
      return [...gameFinished.leaderboard].sort((a, b) => b.score - a.score);
    }
    return scoreboard;
  }, [gameFinished, scoreboard]);

  const isHost = Boolean(
    roomState && playerId && roomState.hostId === playerId,
  );
  const canVote = Boolean(
    roundStarted && timerSeconds === 0 && !hasVoted && !roundRevealed,
  );
  const connectedRoom = roomCode || roomState?.code || "";

  const page = useMemo(() => {
    if (gameFinished || roomState?.finished) {
      return "podium";
    }
    if (roundRevealed) {
      return "reveal";
    }
    if (roundStarted) {
      return "round";
    }
    if (connectedRoom) {
      return "lobby";
    }
    return "home";
  }, [
    connectedRoom,
    gameFinished,
    roomState?.finished,
    roundRevealed,
    roundStarted,
  ]);

  const connectSocket = () => {
    if (socket) {
      socket.disconnect();
    }

    const nextSocket = io(backendUrl, {
      transports: ["websocket"],
    });

    nextSocket.on("connect", () => {
      setConnected(true);
      setError("");
    });

    nextSocket.on("disconnect", () => {
      setConnected(false);
    });

    nextSocket.on("room_state", (payload: RoomState) => {
      setRoomState(payload);
      if (payload.finished) {
        setRoundStarted(null);
        setRoundRevealed(null);
      }
    });

    nextSocket.on("round_started", (payload: RoundStartedPayload) => {
      setRoundStarted(payload);
      setRoundRevealed(null);
      setHasVoted(false);
      setVoteProgress("");
      setShowCard(false);

      if (roundTransitionTimerRef.current) {
        window.clearTimeout(roundTransitionTimerRef.current);
      }

      roundTransitionTimerRef.current = window.setTimeout(() => {
        setShowCard(true);
      }, 1400);
    });

    nextSocket.on("round_revealed", (payload: RoundRevealedPayload) => {
      setRoundRevealed(payload);
    });

    nextSocket.on(
      "vote_progress",
      (payload: { submittedCount: number; totalPlayers: number }) => {
        setVoteProgress(
          `${payload.submittedCount}/${payload.totalPlayers} votes in`,
        );
      },
    );

    nextSocket.on("game_finished", (payload: GameFinishedPayload) => {
      setGameFinished(payload);
      setRoundStarted(null);
      setRoundRevealed(null);
    });

    nextSocket.on("server_error", (payload: { message: string }) => {
      setError(payload.message);
    });

    setSocket(nextSocket);
  };

  useEffect(() => {
    connectSocket();

    return () => {
      if (roundTransitionTimerRef.current) {
        window.clearTimeout(roundTransitionTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!roundStarted) {
      return;
    }

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [roundStarted]);

  useEffect(() => {
    return () => {
      socket?.disconnect();
    };
  }, [socket]);

  const createRoom = () => {
    if (!socket) {
      setError("Still connecting. Try again in 1 second.");
      return;
    }

    socket.emit(
      "create_room",
      { name: displayName, totalRounds },
      (response: {
        ok: boolean;
        error?: string;
        roomCode?: string;
        playerId?: string;
      }) => {
        if (!response.ok) {
          setError(response.error ?? "Could not create room");
          return;
        }

        setRoomCode(response.roomCode ?? "");
        setPlayerId(response.playerId ?? "");
        setJoinCode(response.roomCode ?? "");
        setError("");
      },
    );
  };

  const joinRoom = () => {
    if (!socket) {
      setError("Still connecting. Try again in 1 second.");
      return;
    }

    socket.emit(
      "join_room",
      { roomCode: joinCode, name: displayName },
      (response: {
        ok: boolean;
        error?: string;
        roomCode?: string;
        playerId?: string;
      }) => {
        if (!response.ok) {
          setError(response.error ?? "Could not join room");
          return;
        }

        setRoomCode(response.roomCode ?? "");
        setPlayerId(response.playerId ?? "");
        setError("");
      },
    );
  };

  const sendSimpleEvent = (
    eventName: "start_game" | "reveal_round" | "next_round",
  ) => {
    if (!socket) {
      setError("Still connecting. Try again in 1 second.");
      return;
    }

    socket.emit(eventName, {}, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setError(response.error ?? `Failed: ${eventName}`);
        return;
      }

      setError("");
      if (eventName === "next_round") {
        setRoundRevealed(null);
      }
    });
  };

  const submitVote = (vote: Vote) => {
    if (!socket) {
      setError("Still connecting. Try again in 1 second.");
      return;
    }

    socket.emit(
      "submit_vote",
      { vote },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setError(response.error ?? "Vote failed");
          return;
        }

        setError("");
        setHasVoted(true);
      },
    );
  };

  const renderHome = () => (
    <section className="screen home-screen">
      <div className="hero-card">
        <h1>Fact or Cap</h1>
        <p>Spot truth. Expose bias. Outsmart the manipulator.</p>
      </div>

      <section className="card stack-card">
        <h2>Join or Host</h2>

        <label>
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Type your name"
          />
        </label>

        <div className="split-input">
          <label>
            Room code
            <input
              value={joinCode}
              onChange={(event) =>
                setJoinCode(event.target.value.toUpperCase())
              }
              placeholder="AB12C"
            />
          </label>
          <label>
            Total rounds
            <input
              type="number"
              min={1}
              max={20}
              value={totalRounds}
              onChange={(event) =>
                setTotalRounds(Number(event.target.value) || 1)
              }
            />
          </label>
        </div>

        <div className="row">
          <button
            type="button"
            onClick={createRoom}
            disabled={!displayName.trim()}
          >
            Create Game
          </button>
          <button
            type="button"
            onClick={joinRoom}
            disabled={!displayName.trim() || !joinCode.trim()}
          >
            Join Game
          </button>
        </div>

        <p className="meta">
          Socket status: {connected ? "Connected" : "Connecting..."}
        </p>
      </section>
    </section>
  );

  const renderLobby = () => (
    <section className="screen">
      <section className="card">
        <h2>Lobby</h2>
        <p className="meta">Room code: {connectedRoom}</p>
        <p className="meta">Rounds: {roomState?.totalRounds ?? totalRounds}</p>

        <ul className="list">
          {scoreboard.map((player) => (
            <li key={player.id}>
              {player.name} {player.id === roomState?.hostId ? "(Host)" : ""}{" "}
              {player.connected ? "" : "(Offline)"}
            </li>
          ))}
        </ul>

        {isHost ? (
          <button type="button" onClick={() => sendSimpleEvent("start_game")}>
            Start Round 1
          </button>
        ) : (
          <p className="meta">Waiting for host to start.</p>
        )}
      </section>
    </section>
  );

  const renderRound = () => (
    <section className="screen round-screen">
      <section className="card role-chip-wrap">
        <div className="role-chip">
          {roundStarted?.myRole === "manipulator" ? "Manipulator" : "Citizen"}
        </div>
        <div className="round-meta">
          Round {roundStarted?.roundNumber}/{roundStarted?.totalRounds}
        </div>
        <div className="round-meta timer">
          Debate time left: {timerSeconds}s
        </div>
      </section>

      <section className={`card prompt-card ${showCard ? "is-visible" : ""}`}>
        <h2>{roundStarted?.headline ?? "Loading prompt..."}</h2>
        <p>{roundStarted?.description ?? ""}</p>
        <p className={`truth-badge ${roundStarted?.truth}`}>
          FOR TESTING ONLY:{" "}
          {roundStarted?.truth === "fake" ? "AI GENERATED" : "REAL ARTICLE"}
        </p>

        {roundStarted?.myRole === "manipulator" ? (
          <p className="meta">
            You know the truth: {roundStarted.truth?.toUpperCase() ?? "-"}
          </p>
        ) : (
          <p className="meta">Discuss and decide.</p>
        )}
      </section>

      <section className="card">
        <h2>Vote</h2>
        <div className="row vote-row">
          <button
            type="button"
            className="vote real"
            onClick={() => submitVote("real")}
            disabled={!canVote}
          >
            REAL
          </button>
          <button
            type="button"
            className="vote fake"
            onClick={() => submitVote("fake")}
            disabled={!canVote}
          >
            FAKE
          </button>
        </div>

        {!canVote ? (
          <p className="meta">
            {hasVoted
              ? "Vote submitted. Waiting for reveal."
              : "Voting unlocks when timer reaches 0."}
          </p>
        ) : null}

        <p className="meta">{voteProgress}</p>
        {isHost ? (
          <button type="button" onClick={() => sendSimpleEvent("reveal_round")}>
            Reveal Results
          </button>
        ) : null}
      </section>
    </section>
  );

  const renderReveal = () => (
    <section className="screen">
      <section className="card reveal-hero">
        <h2>Answer: {roundRevealed?.answer?.toUpperCase()}</h2>
        <p>
          Manipulator fooled {roundRevealed?.manipulatorFooledCount ?? 0}{" "}
          player(s).
        </p>
      </section>

      <section className="card">
        <h2>Who Got It Right?</h2>
        <ul className="list">
          {(roundRevealed?.players ?? []).map((player) => (
            <li key={player.id}>
              {player.name} | role: {player.role} | vote:{" "}
              {player.vote?.toUpperCase() ?? "-"} |{" "}
              {player.gotItRight === null
                ? "Manipulator"
                : player.gotItRight
                  ? "Correct"
                  : "Wrong"}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Scoreboard</h2>
        <ol className="list">
          {scoreboard.map((player) => (
            <li key={player.id}>
              {player.name} - {player.score}
            </li>
          ))}
        </ol>

        {isHost ? (
          <button type="button" onClick={() => sendSimpleEvent("next_round")}>
            Next Round
          </button>
        ) : (
          <p className="meta">Waiting for host to continue.</p>
        )}
      </section>
    </section>
  );

  const renderPodium = () => (
    <section className="screen">
      <section className="card podium-card">
        <h1>Final Podium</h1>
        <div className="podium-grid">
          {podiumBoard.slice(0, 3).map((player, index) => (
            <div key={player.id} className={`podium-slot place-${index + 1}`}>
              <div className="place-label">#{index + 1}</div>
              <div className="place-name">{player.name}</div>
              <div className="place-score">{player.score} pts</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Full Leaderboard</h2>
        <ol className="list">
          {podiumBoard.map((player) => (
            <li key={player.id}>
              {player.name} - {player.score}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );

  return (
    <main className={`test-page page-${page}`}>
      {page === "home" ? renderHome() : null}
      {page === "lobby" ? renderLobby() : null}
      {page === "round" ? renderRound() : null}
      {page === "reveal" ? renderReveal() : null}
      {page === "podium" ? renderPodium() : null}

      {error ? <p className="error global-error">Error: {error}</p> : null}

      <footer className="debug-footer">
        <span>Backend: {backendUrl}</span>
        <span>Connected: {connected ? "yes" : "no"}</span>
        <button type="button" onClick={connectSocket}>
          Reconnect
        </button>
      </footer>
    </main>
  );
}

export default App;
