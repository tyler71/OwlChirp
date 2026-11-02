import AdminPermissions from './AdminPermissions';
import AdminUsers from './AdminUsers';

// Admin-only settings; App hides this view below admin permission.
export default function Admin() {
  return (
    <div className="flex flex-col gap-6">
      <AdminPermissions />
      <AdminUsers />
    </div>
  );
}
