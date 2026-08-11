import { useEffect, useState } from "react";
import { Clock, Radio } from "lucide-react";

const SERVER_URL = "https://broadcasting-github-io.onrender.com";

function formatHour(h) {
  const period = h >= 12 ? "PM" : "AM";
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:00 ${period}`;
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function isSlotActiveNow(slot, timezone) {
  const hour =
    Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(Date.now())
    ) % 24;
  const { start, end } = slot;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export default function ScheduleBoard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/schedule`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // Re-check which slot is "on air" every minute, in case the page is
  // left open across a schedule boundary.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (error || !data) return null;

  const hasSchedule = data.schedule && data.schedule.length > 0;
  const slots = hasSchedule
    ? data.schedule
    : data.fallback
    ? [{ allDay: true, playlistId: data.fallback.playlistId, tracks: data.fallback.tracks }]
    : [];

  if (slots.length === 0) return null;

  return (
    <div className="dsb-root">
      <style>{`
        .dsb-root {
          font-family: 'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif;
          width: 100%;
          border-radius: clamp(14px, 3vw, 22px);
          background: #2a1608;
          box-shadow: 0 24px 70px rgba(15,8,3,0.5);
          padding: clamp(14px, 1.8vw, 22px);
          box-sizing: border-box;
          max-height: 100%;
        }
        .dsb-header {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #fbf3e6;
          font-size: clamp(13px, 1.6vw, 17px);
          font-weight: 600;
          margin-bottom: clamp(10px, 1.6vw, 16px);
        }
        .dsb-slots {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-height: 640px;
          overflow-y: auto;
          padding-right: 2px;
        }
        .dsb-slots::-webkit-scrollbar { width: 5px; }
        .dsb-slots::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

        .dsb-slot {
          border-radius: 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          overflow: hidden;
        }
        .dsb-slot-active {
          background: rgba(232,161,58,0.10);
          border: 1px solid rgba(232,161,58,0.4);
        }
        .dsb-slot-time {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px clamp(10px, 1.8vw, 15px);
          font-size: clamp(11.5px, 1.4vw, 14px);
          font-weight: 600;
          color: #fbf3e6;
        }
        .dsb-live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #7ed858;
          box-shadow: 0 0 0 0 rgba(126,216,88,0.5);
          animation: dsbPulse 2s ease-out infinite;
          margin-left: auto;
        }
        .dsb-live-label {
          margin-left: auto;
          font-size: 9.5px;
          letter-spacing: 0.5px;
          color: #7ed858;
          font-weight: 700;
        }
        @keyframes dsbPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(126,216,88,0.5); }
          50% { box-shadow: 0 0 0 5px rgba(126,216,88,0); }
        }
        .dsb-tracks {
          max-height: 190px;
          overflow-y: auto;
          padding: 0 clamp(10px, 1.8vw, 15px) 10px;
        }
        .dsb-tracks::-webkit-scrollbar { width: 4px; }
        .dsb-tracks::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }
        .dsb-track {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          padding: 4px 0;
          border-top: 1px solid rgba(255,255,255,0.05);
        }
        .dsb-track:first-child { border-top: none; }
        .dsb-track-title {
          font-size: clamp(10.5px, 1.3vw, 13px);
          color: rgba(251,243,230,0.85);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
        }
        .dsb-track-duration {
          font-size: 10px;
          color: rgba(251,243,230,0.45);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }
      `}</style>

      <div className="dsb-header">
        <Clock size={15} strokeWidth={2.25} />
        <span>Today&rsquo;s Lineup</span>
      </div>

      <div className="dsb-slots">
        {slots.map((slot, i) => {
          const active = slot.allDay || isSlotActiveNow(slot, data.timezone);
          return (
            <div key={i} className={`dsb-slot ${active ? "dsb-slot-active" : ""}`}>
              <div className="dsb-slot-time">
                {slot.allDay ? (
                  <>
                    <Radio size={12} strokeWidth={2.25} />
                    <span>All day</span>
                  </>
                ) : (
                  <span>{formatHour(slot.start)} &ndash; {formatHour(slot.end)}</span>
                )}
                {active && <span className="dsb-live-label">ON AIR</span>}
                {active && <span className="dsb-live-dot" />}
              </div>
              <div className="dsb-tracks">
                {slot.tracks.map((t, j) => (
                  <div key={j} className="dsb-track">
                    <span className="dsb-track-title">{t.title}</span>
                    <span className="dsb-track-duration">{formatDuration(t.duration)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {hasSchedule && data.fallback && (
          <div className="dsb-slot">
            <div className="dsb-slot-time">
              <span>Outside schedule</span>
            </div>
            <div className="dsb-tracks">
              {data.fallback.tracks.map((t, j) => (
                <div key={j} className="dsb-track">
                  <span className="dsb-track-title">{t.title}</span>
                  <span className="dsb-track-duration">{formatDuration(t.duration)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
