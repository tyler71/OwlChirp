import { useStore } from '@nanostores/react';

import { $contactSnapshot } from '../lib/stores';
import { Card } from './ui';
import WrapupForm from './WrapupForm';

const CS = connect.ContactStateType;

/**
 * Phone tab card holding the notes form for the current call, during the call
 * and in after-call work. Hidden while a call rings or after a missed/failed
 * one, and for calls without a number (nothing to attach notes to).
 */
export default function CallNotes() {
  const contact = useStore($contactSnapshot);
  if (!contact?.phoneNumber) return null;

  const ringing = contact.isInbound && (contact.status === CS.INCOMING || contact.status === CS.CONNECTING);
  const failed = contact.status === CS.MISSED || contact.status === CS.REJECTED || contact.status === CS.ERROR;
  if (ringing || failed) return null;

  return (
    <Card title="Call notes">
      <WrapupForm contactId={contact.contactId} phoneNumber={contact.phoneNumber} />
    </Card>
  );
}
