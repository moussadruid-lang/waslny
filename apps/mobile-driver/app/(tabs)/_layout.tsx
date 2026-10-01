import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@mashawir/mobile-core';

export default function TabsLayout() {
  const icon = (name: any) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: theme.muted, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
      <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarIcon: icon('speedometer-outline') }} />
      <Tabs.Screen name="orders" options={{ title: 'طلباتي', tabBarIcon: icon('cube-outline') }} />
      <Tabs.Screen name="earnings" options={{ title: 'الأرباح', tabBarIcon: icon('cash-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'حسابي', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
