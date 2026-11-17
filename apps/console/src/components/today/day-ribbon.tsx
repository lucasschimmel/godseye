export type RibbonTone = "ok" | "danger" | "unk" | "due";
export interface RibbonEvent {
  id: string;
  at: Date;
  label: string;
  tone: RibbonTone;
}

const hourOf = (date: Date) => date.getHours() + date.getMinutes() / 60;
const pos = (hour: number) => `${((hour / 24) * 100).toFixed(2)}%`;
const clock = (date: Date) =>
  date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/**
 * The owner's day: the past half is observed (solid), the future half is planned (hatched).
 * Only events that belong to the current local day are placed.
 */
export function DayRibbon({ events, now }: { events: RibbonEvent[]; now: Date }) {
  const today = now.toDateString();
  const placed = events.filter((event) => event.at.toDateString() === today);
  const nowHour = hourOf(now);
  return (
    <div className="ribbon">
      <div className="ribbon-track">
        <span className="ribbon-past" style={{ width: pos(nowHour) }} />
        <span className="ribbon-future" style={{ left: pos(nowHour) }} />
        {placed.map((event) => (
          // Pointer-only preview: the same events are listed in the Activité card and the Journal.
          <span
            key={event.id}
            className={`ribbon-ev ${event.tone}`}
            style={{ left: pos(hourOf(event.at)) }}
            aria-hidden="true"
          >
            <b />
            <em>
              <span className="mono">{clock(event.at)}</span>
              {event.label}
            </em>
          </span>
        ))}
        <span className="ribbon-now" style={{ left: pos(nowHour) }}>
          <em className="mono">{clock(now)}</em>
        </span>
      </div>
      <div className="ribbon-axis mono" aria-hidden="true">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
          <span key={hour} style={{ left: pos(hour) }}>
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>
      {!placed.length && (
        <p className="faint small ribbon-empty">Aucun événement enregistré aujourd’hui.</p>
      )}
    </div>
  );
}
