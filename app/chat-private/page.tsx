import { RealtimeChat } from '@/components/realtime-chat';

export default function Page() {
  return (
    <>
      <RealtimeChat
        roomName='Private Chat'
        username='justinrunes'
        isPrivateChat={true}
      />
    </>
  );
}
