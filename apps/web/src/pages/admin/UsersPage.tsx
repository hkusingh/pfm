import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, Badge } from '@pfm/ui';
import { api } from '../../lib/api';

type User = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  isSiteAdmin: boolean;
  createdAt: string;
  _count: { memberships: number; mfaMethods: number };
};

export function UsersPage() {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<User[]>('/admin/users'),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
      <Card>
        <CardHeader>
          <CardTitle>All accounts</CardTitle>
          <span className="text-sm text-gray-500">{users.length} total</span>
        </CardHeader>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-6 py-2 font-medium text-gray-500">Email</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Verified</th>
                  <th className="px-6 py-2 font-medium text-gray-500">MFA</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Households</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Joined</th>
                  <th className="px-6 py-2 font-medium text-gray-500">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium">{u.email}</td>
                    <td className="px-6 py-3">
                      {u.emailVerifiedAt
                        ? <Badge variant="success">Verified</Badge>
                        : <Badge variant="warning">Pending</Badge>}
                    </td>
                    <td className="px-6 py-3">
                      {u._count.mfaMethods > 0
                        ? <Badge variant="success">Enrolled</Badge>
                        : <Badge variant="danger">None</Badge>}
                    </td>
                    <td className="px-6 py-3 text-gray-500">{u._count.memberships}</td>
                    <td className="px-6 py-3 text-gray-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      {u.isSiteAdmin && <Badge variant="info">Site admin</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
