import Stack from 'expo-router/stack';

export default function LibraryStackLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
          headerLargeTitleEnabled: false,
          title: '',
        }}
      />
    </Stack>
  );
}
