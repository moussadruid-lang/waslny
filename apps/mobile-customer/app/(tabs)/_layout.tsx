import React from 'react';
import { View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@mashawir/mobile-core';

export default function TabsLayout() {
  const router = useRouter();
  const icon = (name: any) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: theme.muted, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="orders" options={{ title: 'طلباتي', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="new" options={{
        title: 'طلب جديد',
        tabBarIcon: () => (
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: -14, ...theme.shadow }}>
            <Ionicons name="add" size={30} color="#fff" />
          </View>
        ),
      }} listeners={{ tabPress: (e) => { e.preventDefault(); router.push('/new-order'); } }} />
      <Tabs.Screen name="wallet" options={{ title: 'المحفظة', tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'حسابي', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
