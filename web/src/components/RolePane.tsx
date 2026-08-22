import { Prose } from "../prose";
import type { FileCard, Overview } from "../types";

export function RolePane({
  card,
  overview,
}: {
  card: FileCard;
  overview?: Overview;
}) {
  const roleText = card.roleInPr?.trim() || fallbackRole(card, overview);

  return (
    <div className="context-pane">
      {card.roleInPr ? (
        <>
          <h3>Role in PR</h3>
          <Prose text={card.roleInPr} />
        </>
      ) : (
        <>
          {overview && (
            <>
              <h3>PR motivation</h3>
              <Prose text={overview.why} />
            </>
          )}
          <h3>This file&apos;s role</h3>
          <Prose text={roleText} />
        </>
      )}
      {card.map && (
        <>
          <h3>How it connects</h3>
          <Prose text={card.map} />
        </>
      )}
      {!card.roleInPr && !overview && (
        <>
          <h3>What changed</h3>
          <Prose text={card.what} />
          <h3>Why it changed</h3>
          <Prose text={card.why} />
        </>
      )}
    </div>
  );
}

function fallbackRole(card: FileCard, overview?: Overview): string {
  const bits = [card.what, card.why].filter(Boolean);
  if (overview?.howItConnects) {
    bits.push(
      `In the walk queue, this file sits in: ${overview.howItConnects}`,
    );
  }
  return bits.join("\n\n");
}
