import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { SafeAreaView } from 'react-native-safe-area-context';
import AuthScreen from './src/components/AuthScreen';
import MapScreen from './src/components/MapScreen';
import { supabase, supabaseConfigError } from './src/lib/supabase';

function App() {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!client);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!client) {
      return;
    }

    let active = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setAuthError('');
      }
    });

    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) {
          return;
        }
        if (error) {
          setAuthError(error.message);
        }
        setSession(data.session);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthError(
            error instanceof Error ? error.message : 'Could not restore your session.',
          );
          setLoading(false);
        }
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  if (!client) {
    return <SetupMessage message={supabaseConfigError ?? 'Supabase is unavailable.'} />;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#44c9ad" size="large" />
        <Text style={styles.loadingText}>Loading your account…</Text>
      </SafeAreaView>
    );
  }

  if (session) {
    return (
      <MapScreen
        client={client}
        user={session.user}
        onSignOut={async () => {
          const { error } = await client.auth.signOut();
          if (error) {
            throw error;
          }
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      {!!authError && (
        <Text accessibilityRole="alert" style={styles.authError}>
          {authError}
        </Text>
      )}
      <AuthScreen client={client} />
    </View>
  );
}

function SetupMessage({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.setup}>
      <Text style={styles.setupTitle}>Configuration required</Text>
      <Text style={styles.setupText}>{message}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#0b1020',
  },
  loadingText: { color: '#c4ccdc', fontSize: 14 },
  authError: {
    color: '#ffb2b2',
    backgroundColor: '#8f2f43',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  setup: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0b1020',
  },
  setupTitle: {
    color: '#eef2ff',
    fontSize: 23,
    fontWeight: '700',
    marginBottom: 12,
  },
  setupText: {
    color: '#c4ccdc',
    fontSize: 15,
    lineHeight: 23,
  },
});

export default App;
