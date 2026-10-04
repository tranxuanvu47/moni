import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { AppIcon, categoryIconNames } from '@/src/components/ui/Icon';
import { getDatabase } from '@/src/database/expo-client';
import { createCategory, deleteCategory, listCategories, updateCategory } from '@/src/database/repositories/categories';
import { colors, radius } from '@/src/theme/tokens';
import type { Category } from '@/src/types/finance';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>('ellipsis');

  const reload = useCallback(async () => {
    setCategories(await listCategories(getDatabase()));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  function edit(category: Category) {
    setSelectedId(category.id);
    setName(category.name);
    setIcon(category.icon);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    const db = getDatabase();
    if (selectedId) {
      const current = categories.find((category) => category.id === selectedId);
      await updateCategory(db, selectedId, { name: trimmed, icon, color: current?.color ?? '#777F79' });
    } else {
      await createCategory(db, { name: trimmed, icon, color: '#777F79', type: 'expense' });
    }
    setSelectedId(null);
    setName('');
    setIcon('ellipsis');
    await reload();
  }

  function remove(category: Category) {
    Alert.alert('Xóa hạng mục', category.name, [
      { text: 'Giữ lại', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: () => {
          void deleteCategory(getDatabase(), category.id).then((result) => {
            if (!result.ok) {
              Alert.alert('Không xóa', result.reason);
              return;
            }
            void reload();
          });
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Hạng mục" />
      <ScrollView contentContainerStyle={styles.content}>
        {categories.map((category) => (
          <View key={category.id} style={styles.row}>
            <AppIcon name={category.icon} color={category.color} />
            <AppText style={styles.flex}>{category.name}</AppText>
            <Button label="Sửa" variant="ghost" onPress={() => edit(category)} />
            {!category.isDefault ? <Button label="Xóa" variant="ghost" onPress={() => remove(category)} /> : null}
          </View>
        ))}
        <AppText variant="heading">{selectedId ? 'Sửa hạng mục' : 'Thêm hạng mục'}</AppText>
        <TextInput value={name} onChangeText={setName} placeholder="Tên hạng mục" placeholderTextColor={colors.textSecondary} style={styles.input} />
        <View style={styles.icons}>
          {categoryIconNames.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={item}
              onPress={() => setIcon(item)}
              style={[styles.iconButton, icon === item && styles.iconSelected]}
            >
              <AppIcon name={item} color={icon === item ? colors.surface : colors.primary} />
            </Pressable>
          ))}
        </View>
        <Button label={selectedId ? 'Lưu thay đổi' : 'Thêm'} onPress={() => void save()} disabled={!name.trim()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 8, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  flex: { flex: 1 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    color: colors.text,
    fontFamily: 'Inter_400Regular',
  },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  iconSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
