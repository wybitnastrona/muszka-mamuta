import type { DefecationEvent } from '../metabolism/hemolymph';

/** Replace this component with your game, video, sensor feed or Gymnasium frontend. */
export function Environment({
  time,
  spots = [],
  showSpots = false,
}: {
  time: number;
  spots?: readonly DefecationEvent[];
  showSpots?: boolean;
}) {
  const x = 160 + Math.sin(time * 0.7) * 100;
  return <div className="environment">
    <svg viewBox="0 0 320 320" role="img" aria-label="Example visual stimulus: a moving spot on a grid">
      <defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#242a30" strokeWidth=".5"/></pattern></defs>
      <rect width="320" height="320" fill="url(#grid)"/>
      {showSpots && spots.map((spot, i) => (
        <ellipse
          key={`${spot.timeSec}-${i}`}
          cx={spot.x * 320}
          cy={spot.y * 320}
          rx={4 + spot.mass * 10}
          ry={3 + spot.mass * 7}
          fill="#6b5a45"
          opacity="0.55"
        />
      ))}
      <circle cx={x} cy="160" r="18" fill="#d5dce3"/>
      <path d="M160 150v20m-10-10h20" stroke="#566170"/>
    </svg>
    <p>Example visual stimulus</p><span>Replace with your environment. No model is driven by this spot.</span>
  </div>;
}
