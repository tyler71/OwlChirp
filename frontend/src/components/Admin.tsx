import AdminUsers from './AdminUsers';

// Admin-only settings; App hides this view without the admin feature.
export default function Admin() {
  return (
    <div className="flex flex-col gap-6">
      <AdminUsers />
    </div>
  );
}
