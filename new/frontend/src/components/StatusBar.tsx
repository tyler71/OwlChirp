import CallerId from './CallerId';
import HandledIncoming from './HandledIncoming';
import VisualAgentList from './VisualAgentList';

export default function StatusBar() {
  return (
    <div id="statusBar">
      <CallerId />
      <VisualAgentList />
      <HandledIncoming />
    </div>
  );
}
