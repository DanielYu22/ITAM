import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
} from 'react-native';
import { ChevronRight, ChevronLeft, MapPin, Building2, Layers, DoorOpen } from 'lucide-react-native';
import { Asset } from '../lib/notion';

interface LocationNavigatorProps {
    assets: Asset[];
    locationHierarchy: string[]; // ['건물', '층', '연구실']
    sortColumn?: string; // '동선'
    initialLevel?: number;
    initialSelectedValues?: Record<string, string>;
    onSelectLocation: (filters: Record<string, string>, finalAssets: Asset[]) => void;
}

export const LocationNavigator: React.FC<LocationNavigatorProps> = ({
    assets,
    locationHierarchy,
    sortColumn,
    initialLevel = 0,
    initialSelectedValues = {},
    onSelectLocation,
}) => {
    // 현재 선택된 값들 (각 계층별)
    const [selectedValues, setSelectedValues] = useState<Record<string, string>>(initialSelectedValues);
    const [currentLevel, setCurrentLevel] = useState(initialLevel);

    // 계층 아이콘
    const levelIcons = [Building2, Layers, DoorOpen, MapPin];

    // 현재 레벨까지 필터된 자산들
    const filteredAssets = useMemo(() => {
        let result = assets;

        for (let i = 0; i < currentLevel; i++) {
            const col = locationHierarchy[i];
            const val = selectedValues[col];
            if (val) {
                result = result.filter(a => a.values[col] === val);
            }
        }

        return result;
    }, [assets, locationHierarchy, selectedValues, currentLevel]);

    // 현재 레벨에서 사용 가능한 값들
    const availableValues = useMemo(() => {
        if (currentLevel >= locationHierarchy.length) {
            return [];
        }

        const col = locationHierarchy[currentLevel];

        // 정렬 컬럼(동선)이 있으면 해당 컬럼 기준으로 자산을 먼저 정렬한 후 중복 제거
        if (sortColumn) {
            const sortedAssets = [...filteredAssets].sort((a, b) => {
                const valA = a.values[sortColumn];
                const valB = b.values[sortColumn];

                // 둘 다 값이 있는 경우 숫자 비교
                if (valA && valB) {
                    const numA = parseFloat(valA);
                    const numB = parseFloat(valB);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                    }
                }

                // 값이 없는 경우 뒤로 보냄
                if (!valA && valB) return 1;
                if (valA && !valB) return -1;

                // 둘 다 없거나 숫자가 아닌 경우 문자열 비교
                return (valA || '').localeCompare(valB || '');
            });

            const uniqueValues: string[] = [];
            const valueSet = new Set<string>();

            sortedAssets.forEach(asset => {
                const val = String(asset.values[col] ?? '');
                if (val && val.trim() && !valueSet.has(val)) {
                    valueSet.add(val);
                    uniqueValues.push(val);
                }
            });

            return uniqueValues;
        }

        // 정렬 컬럼이 없는 경우 기존처럼 알파벳 순 정렬
        const valueSet = new Set<string>();
        filteredAssets.forEach(asset => {
            const val = String(asset.values[col] ?? '');
            if (val && val.trim()) {
                valueSet.add(val);
            }
        });

        return Array.from(valueSet).sort();
    }, [filteredAssets, locationHierarchy, currentLevel, sortColumn]);

    // 최종 자산 목록 (정렬 적용)
    const finalAssets = useMemo(() => {
        if (currentLevel < locationHierarchy.length) {
            return [];
        }

        let result = [...filteredAssets];

        // 정렬 컬럼이 있으면 정렬
        if (sortColumn) {
            result.sort((a, b) => {
                const valA = parseFloat(a.values[sortColumn]) || 0;
                const valB = parseFloat(b.values[sortColumn]) || 0;
                return valA - valB;
            });
        }

        return result;
    }, [filteredAssets, sortColumn, currentLevel, locationHierarchy.length]);

    // 값 선택
    const selectValue = (value: string) => {
        const col = locationHierarchy[currentLevel];
        const newSelected = { ...selectedValues, [col]: value };
        setSelectedValues(newSelected);

        const nextLevel = currentLevel + 1;
        setCurrentLevel(nextLevel);

        // 마지막 레벨이면 자산 목록 전달
        if (nextLevel >= locationHierarchy.length) {
            let result = assets;
            for (let i = 0; i < locationHierarchy.length; i++) {
                const c = locationHierarchy[i];
                const v = newSelected[c];
                if (v) {
                    result = result.filter(a => a.values[c] === v);
                }
            }

            // 정렬 적용
            if (sortColumn) {
                result.sort((a, b) => {
                    const valA = parseFloat(a.values[sortColumn]) || 0;
                    const valB = parseFloat(b.values[sortColumn]) || 0;
                    return valA - valB;
                });
            }

            onSelectLocation(newSelected, result);
        }
    };

    // 뒤로가기
    const goBack = () => {
        if (currentLevel > 0) {
            const prevLevel = currentLevel - 1;
            const col = locationHierarchy[prevLevel];
            const newSelected = { ...selectedValues };
            delete newSelected[col];
            setSelectedValues(newSelected);
            setCurrentLevel(prevLevel);
            onSelectLocation({}, []);
        }
    };

    // 처음으로
    const reset = () => {
        setSelectedValues({});
        setCurrentLevel(0);
        onSelectLocation({}, []);
    };

    // 위치 계층이 설정되지 않은 경우
    if (locationHierarchy.length === 0) {
        return null;
    }

    // 모든 레벨 선택 완료
    if (currentLevel >= locationHierarchy.length) {
        return (
            <View style={styles.breadcrumbContainer}>
                <TouchableOpacity style={styles.backButton} onPress={reset}>
                    <ChevronLeft size={20} color="#6366f1" />
                    <Text style={styles.backButtonText}>처음으로</Text>
                </TouchableOpacity>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.breadcrumbs}>
                        {locationHierarchy.map((col, idx) => (
                            <View key={col} style={styles.breadcrumbItem}>
                                {idx > 0 && <ChevronRight size={16} color="#9ca3af" />}
                                <Text style={styles.breadcrumbText}>
                                    {selectedValues[col]}
                                </Text>
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </View>
        );
    }

    const currentCol = locationHierarchy[currentLevel];
    const LevelIcon = levelIcons[currentLevel] || MapPin;
    const levelLabels = ['건물', '층', '연구실', '구역'];

    return (
        <View style={styles.container}>
            {/* 헤더 */}
            <View style={styles.header}>
                {currentLevel > 0 ? (
                    <TouchableOpacity style={styles.backButton} onPress={goBack}>
                        <ChevronLeft size={20} color="#6366f1" />
                        <Text style={styles.backButtonText}>뒤로</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={styles.levelInfo}>
                        <LevelIcon size={20} color="#6366f1" />
                        <Text style={styles.levelTitle}>
                            {levelLabels[currentLevel] || currentCol} 선택
                        </Text>
                    </View>
                )}

                <Text style={styles.countText}>
                    {availableValues.length}개
                </Text>
            </View>

            {/* 선택된 경로 표시 */}
            {currentLevel > 0 && (
                <View style={styles.selectedPath}>
                    {locationHierarchy.slice(0, currentLevel).map((col, idx) => (
                        <View key={col} style={styles.pathItem}>
                            {idx > 0 && <Text style={styles.pathSeparator}> → </Text>}
                            <Text style={styles.pathText}>{selectedValues[col]}</Text>
                        </View>
                    ))}
                </View>
            )}

            {/* 값 목록 */}
            <ScrollView style={styles.valueList}>
                {availableValues.map(value => {
                    // 해당 값을 선택했을 때의 자산 수 계산
                    const col = locationHierarchy[currentLevel];
                    const count = filteredAssets.filter(a => a.values[col] === value).length;

                    return (
                        <TouchableOpacity
                            key={value}
                            style={styles.valueItem}
                            onPress={() => selectValue(value)}
                        >
                            <View style={styles.valueLeft}>
                                <LevelIcon size={18} color="#6366f1" />
                                <Text style={styles.valueText}>{value}</Text>
                            </View>
                            <View style={styles.valueRight}>
                                <Text style={styles.valueCount}>{count}개</Text>
                                <ChevronRight size={18} color="#9ca3af" />
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    backButtonText: {
        fontSize: 15,
        color: '#6366f1',
        fontWeight: '500',
    },
    levelInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    levelTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1f2937',
    },
    countText: {
        fontSize: 14,
        color: '#6b7280',
    },
    selectedPath: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 12,
        backgroundColor: '#eef2ff',
        borderBottomWidth: 1,
        borderBottomColor: '#c7d2fe',
    },
    pathItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    pathSeparator: {
        color: '#6366f1',
        fontSize: 14,
    },
    pathText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#4f46e5',
    },
    valueList: {
        flex: 1,
    },
    valueItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    valueLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    valueText: {
        fontSize: 16,
        color: '#1f2937',
    },
    valueRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    valueCount: {
        fontSize: 14,
        color: '#6b7280',
    },
    breadcrumbContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#eef2ff',
        borderBottomWidth: 1,
        borderBottomColor: '#c7d2fe',
        gap: 12,
    },
    breadcrumbs: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    breadcrumbItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    breadcrumbText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#4f46e5',
        marginLeft: 4,
    },
});
