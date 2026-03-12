/** Configurable artificial delay to simulate network latency */
export let DELAY_MS = 100;

export function setDelay(ms) {
	DELAY_MS = ms;
}

export function delay(ms = DELAY_MS) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
