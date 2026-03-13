export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
	id: string;
	type: ToastType;
	message: string;
}

class ToastStore {
	items = $state<ToastItem[]>([]);

	add(message: string, type: ToastType = 'info', duration = 5000) {
		const id = crypto.randomUUID();
		this.items = [...this.items, { id, type, message }];
		setTimeout(() => this.remove(id), duration);
	}

	remove(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toastStore = new ToastStore();
