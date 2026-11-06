import { StatusBar, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar />
      <Text style={styles.title}>QAir-Vis</Text>
      <Text style={styles.subtitle}>Your app is ready to build.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#4b5563',
    fontSize: 16,
    marginTop: 8,
  },
});

export default App;
