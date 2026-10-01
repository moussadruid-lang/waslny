import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatScreen, useAuth } from '@mashawir/mobile-core';

export default function Chat() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const { me } = useAuth();
  return <ChatScreen orderId={orderId} myUserId={me?.id ?? ''} title="محادثة العميل" onBack={() => router.back()}
    quickReplies={['أنا في الطريق', 'وصلت، أنا تحت', 'ممكن تبعت اللوكيشن؟', 'هاتصل بيك حالًا']} />;
}
