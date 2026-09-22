import { reportError } from '@/lib/observability';
import { Image } from 'expo-image';
import { introArtworks } from '../guest/artwork-preview';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Gallery, SettingsOutline } from '@/constants/theme';


const SOURCE_URL = 'https://github.com/dwjiang/artlog-app';
const FEEDBACK_URL = `${SOURCE_URL}/issues/new`;
const ANTON_LICENSE_URL = 'https://github.com/google/fonts/blob/main/ofl/anton/OFL.txt';

export function AboutSection() {
  const [error, setError] = useState<string>();
  async function open(url: string) {
    setError(undefined);
    try { await Linking.openURL(url); }
    catch (cause) { reportError(cause, 'settings.open-link', { level: 'warning' }); setError("Couldn't open the link. Try again."); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 24 }}>
    <View style={{ gap: 6, paddingTop: 18 }}><ThemedText variant="wordmark" style={{ fontSize: 64, lineHeight: 76 }} accessibilityRole="header">Artlog</ThemedText><ThemedText type="small" themeColor="textSecondary">Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'}</ThemedText></View>
    <View accessibilityElementsHidden style={{ height: 220 }}>
      {[{ art: introArtworks.lilies, left: '0%' as const, rotate: '-12deg', top: 28 }, { art: introArtworks.stars, left: '60%' as const, rotate: '10deg', top: 28 }, { art: introArtworks.pearl, left: '30%' as const, rotate: '4deg', top: 8 }].map(({ art, left, rotate, top }) => <View key={art.title} style={{ position: 'absolute', left, top, width: '40%', height: 180, backgroundColor: Gallery.surface, padding: 5, transform: [{ rotate }], boxShadow: '0 5px 12px #17171724' }}><Image source={art.source} contentFit="cover" accessible={false} style={{ width: '100%', height: '100%' }} /></View>)}
    </View>
    <View style={{ ...SettingsOutline, overflow: 'hidden' }}>
      {[
        { label: 'Privacy policy', icon: 'lock', action: () => router.push({ pathname: '/settings-detail', params: { section: 'privacy' } }) },
        { label: 'Terms', icon: 'doc.text', detail: 'Coming soon' },
        { label: 'Source code', icon: 'chevron.left.forwardslash.chevron.right', action: () => { void open(SOURCE_URL); } },
        { label: 'Send feedback', icon: 'envelope', action: () => { void open(FEEDBACK_URL); } },
        { label: 'Anton font and license', icon: 'info.circle', action: () => { void open(ANTON_LICENSE_URL); } },
      ].map(({ label, icon, detail, action }, index) => <Pressable key={label} accessibilityRole={action ? 'button' : 'text'} accessibilityLabel={label} onPress={action} disabled={!action}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 52, backgroundColor: pressed ? Gallery.fill : Gallery.surface, borderTopWidth: index ? SettingsOutline.borderWidth : 0, borderTopColor: SettingsOutline.borderColor })}>
        <Image source={`sf:${icon}`} tintColor={Gallery.ink} style={{ width: 18, height: 18 }} /><ThemedText style={{ flex: 1, fontSize: 15 }}>{label}</ThemedText>
        {detail ? <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText> : <Image source="sf:chevron.right" tintColor={Gallery.muted} style={{ width: 10, height: 12 }} />}
      </Pressable>)}
    </View>
    {error && <ThemedText themeColor="error" accessibilityRole="alert">{error}</ThemedText>}
    <ThemedText type="small" themeColor="textSecondary" onPress={() => { void open('https://commons.wikimedia.org/wiki/File:Art_Institute_of_Chicago_from_across_Michigan_Avenue.jpg'); }} accessibilityRole="link">Art Institute of Chicago photograph: Beyond My Ken, 2011 · CC BY-SA 4.0. Displayed cropped.</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">Anton by Vernon Adams. Copyright 2020 The Anton Project Authors. Licensed under the SIL Open Font License, Version 1.1.</ThemedText>
  </ScrollView>;
}
