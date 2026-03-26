export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
	id: string;
	type: ToastType;
	message: string;
	project?: string;
}

class ToastStore {
	items = $state<ToastItem[]>([]);
	#timers = new Map<string, ReturnType<typeof setTimeout>>();

	add(message: string, type: ToastType = 'info', duration = 5000, project?: string) {
		const id = crypto.randomUUID();
		this.items = [...this.items, { id, type, message, project }];
		this.#timers.set(id, setTimeout(() => this.remove(id), duration));
	}

	remove(id: string) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toastStore = new ToastStore();
