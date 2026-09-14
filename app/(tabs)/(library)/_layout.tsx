import Stack from 'expo-router/stack';

export default function LibraryStackLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitleEnabled: true,
          title: '书库',
        }}
      />
    </Stack>
  );
}
