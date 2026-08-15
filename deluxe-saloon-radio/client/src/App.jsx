import BroadcastingRadioPlayer from "./BroadcastingRadioPlayer.jsx";
import ScheduleBoard from "./ScheduleBoard.jsx";

export default function App() {
  return (
    <div className="page-wrap">
      <style>{`
        .page-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
        }
        .app-shell {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: clamp(16px, 2.5vw, 32px);
          width: 100%;
          max-width: 1320px;
          margin: 0 auto;
        }
        .app-shell > :first-child { flex: 1 1 700px; max-width: 880px; }
        .app-shell > :last-child { flex: 0 0 340px; max-width: 340px; }

        /* Extra room on large desktop monitors instead of sitting small
           and centered with empty space on either side. */
        @media (min-width: 1300px) {
          .app-shell { max-width: 1440px; gap: 36px; }
          .app-shell > :first-child { max-width: 960px; }
          .app-shell > :last-child { max-width: 380px; }
        }

        @media (max-width: 860px) {
          .app-shell {
            flex-direction: column;
            align-items: stretch;
          }
          .app-shell > :first-child,
          .app-shell > :last-child {
            max-width: 100%;
            flex: 1 1 auto;
          }
        }

        .page-footer {
          margin-top: clamp(14px, 2.5vw, 22px);
          font-family: 'Poppins', 'Segoe UI', system-ui, -apple-system, sans-serif;
          font-size: clamp(11px, 1.4vw, 13px);
          color: rgba(251,243,230,0.4);
          text-align: center;
        }
      `}</style>
      <div className="app-shell">
        <BroadcastingRadioPlayer />
        <ScheduleBoard />
      </div>
      <div className="page-footer">Created by Abhi</div>
    </div>
  );
}
