import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatScreen, useAuth } from '@mashawir/mobile-core';

export default function Chat() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const { me } = useAuth();
  return <ChatScreen orderId={orderId} myUserId={me?.id ?? ''} title="محادثة المندوب" onBack={() => router.back()}
    quickReplies={['اتصل بيا لو سمحت', 'أنا مستنيك تحت', 'العنوان واضح؟', 'شكرًا ليك']} />;
}
