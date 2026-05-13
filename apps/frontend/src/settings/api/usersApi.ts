export interface User {
  uid: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  dialCode: string;
  role: 'customer' | 'admin' | 'owner';
  mustChangePassword: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  phone: string;
  country: string;
  role: 'customer' | 'admin' | 'owner';
}

export interface UpdateUserPayload {
  name?: string;
  phone?: string;
  country?: string;
  role?: 'customer' | 'admin' | 'owner';
}

export type CreateUserResponse = User & { temporaryPassword: string };

export async function getUsers(): Promise<User[]> {
  const response = await fetch('/api/users');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function createUser(payload: CreateUserPayload): Promise<CreateUserResponse> {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function updateUser(uid: string, payload: UpdateUserPayload): Promise<User> {
  const response = await fetch(`/api/users/${uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function deleteUser(uid: string): Promise<void> {
  const response = await fetch(`/api/users/${uid}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${response.status}`);
  }
}
