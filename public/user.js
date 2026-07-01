const USER_KEY = 'matchlink-user-id';

export function getUserId() {
  let id = localStorage.getItem(USER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

export async function fetchUser(userId) {
  const res = await fetch(`/api/user/${userId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function saveProfile(userId, data) {
  const res = await fetch(`/api/user/${userId}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fetchAdminUsers(adminId) {
  const res = await fetch(`/api/admin/users?adminId=${adminId}`);
  if (!res.ok) return null;
  return res.json();
}
