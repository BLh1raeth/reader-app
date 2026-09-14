import Stack from 'expo-router/stack';

export default function LibraryStackLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitleEnabled: true,
          headerLargeTitleShadowVisible: false,
          title: '书库',
        }}
      />
    </Stack>
  );
}
