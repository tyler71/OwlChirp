import CallerId from './CallerId';
import HandledIncoming from './HandledIncoming';
import VisualAgentList from './VisualAgentList';

export default function StatusBar() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-secondary-200 bg-secondary-50 px-4 py-2.5 dark:border-secondary-800 dark:bg-secondary-950/40">
      <CallerId />
      <VisualAgentList />
      <HandledIncoming />
    </div>
  );
}
