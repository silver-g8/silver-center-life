/* ------------------------------------------------------------------------- */
/* Overlap lane assignment — pure layout math, no DOM, no React.              */
/*                                                                            */
/* Week view puts several events side by side when their times collide. This  */
/* file decides ONLY which column each event gets and how many columns its    */
/* neighbourhood needs; turning that into px/% is the view's job.             */
/*                                                                            */
/* Kept separate from calendar.ts on purpose: that file owns reading and      */
/* parsing calendar.md, this one owns geometry. Both Day and Week view feed   */
/* it the same CalEvent shape, so the parser's guards (no backwards range, no */
/* zero-length event) are inherited here for free — this file never has to    */
/* re-check them.                                                             */
/* ------------------------------------------------------------------------- */

/* Only the two fields the algorithm actually reads, so a test can pass plain
   objects and Week view can pass a full CalEvent. */
export type Spanned = {
	startMin: number;
	endMin: number | null; // null = point event, see POINT_MIN
};

/* A point event has no end, but it still occupies space and can still collide.
   The Day view draws it POINT_PX (22) tall against HOUR_PX (44) per hour, so
   visually it already stands for half an hour — matching that here keeps the
   collision maths and the pixels telling the same story. */
export const POINT_MIN = 30;

export type Lane = {
	lane: number; // 0-based column index
	laneCount: number; // columns needed by this event's overlap cluster
};

/* Where an event really ends for collision purposes. */
function effectiveEnd(ev: Spanned, pointMin: number): number {
	return ev.endMin === null ? ev.startMin + pointMin : ev.endMin;
}

/* Assigns each event a column.
 *
 * Returns an array PARALLEL TO THE INPUT — result[i] describes events[i] — so
 * the caller can zip it back without re-sorting or matching on identity.
 *
 * Two events sharing only an edge (one ends exactly when the next starts) do
 * NOT overlap and stay in the same column; a week grid that split them would
 * waste half its width on back-to-back meetings.
 *
 * `laneCount` is per CLUSTER, not per file: a run of events joined by overlap,
 * even transitively (A overlaps B, B overlaps C, A and C are strangers) shares
 * one width so their columns line up. A later, unrelated cluster is free to be
 * narrower.
 */
export function laneAssign(
	events: Spanned[],
	pointMin: number = POINT_MIN
): Lane[] {
	/* Sort by start, then longest-first, but carry the original index so the
	   result can be written back in input order. Longest-first keeps the big
	   block in column 0, where it reads as the "main" event of the cluster. */
	const order = events
		.map((ev, i) => ({ ev, i }))
		.sort((a, b) => {
			if (a.ev.startMin !== b.ev.startMin)
				return a.ev.startMin - b.ev.startMin;
			return (
				effectiveEnd(b.ev, pointMin) - effectiveEnd(a.ev, pointMin)
			);
		});

	const result: Lane[] = new Array(events.length);

	/* laneEnd[l] = when the last event placed in column l finishes. */
	let laneEnd: number[] = [];
	/* Indices (into `result`) of the cluster being built, so its laneCount can
	   be stamped on every member once the cluster's width is known. */
	let cluster: number[] = [];
	/* The furthest any cluster member reaches; the cluster ends when an event
	   starts at or after this, because then it touches none of them. */
	let clusterEnd = -Infinity;

	const closeCluster = () => {
		const laneCount = laneEnd.length;
		for (const idx of cluster) result[idx].laneCount = laneCount;
		laneEnd = [];
		cluster = [];
	};

	for (const { ev, i } of order) {
		const start = ev.startMin;
		const end = effectiveEnd(ev, pointMin);

		/* Starting at or after everything so far means a clean break: the
		   previous cluster's width is final. */
		if (start >= clusterEnd && cluster.length > 0) {
			closeCluster();
			clusterEnd = -Infinity;
		}

		/* First column whose occupant has already finished. `<=` is what makes
		   a touching pair share a column. */
		let lane = laneEnd.findIndex((e) => e <= start);
		if (lane === -1) {
			lane = laneEnd.length; // every column busy — open a new one
		}

		laneEnd[lane] = end;
		result[i] = { lane, laneCount: 0 }; // laneCount filled by closeCluster
		cluster.push(i);
		clusterEnd = Math.max(clusterEnd, end);
	}

	if (cluster.length > 0) closeCluster();

	return result;
}
