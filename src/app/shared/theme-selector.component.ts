import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import {
  AppPreferencesService,
  SUPPORTED_THEME_MODES,
  ThemeMode,
} from '../core/app-preferences.service';

interface ThemeOption {
  value: ThemeMode;
  label: string;
  icon: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: 'System', icon: 'brightness_auto' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
];

@Component({
  selector: 'app-theme-selector',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  templateUrl: './theme-selector.component.html',
  styleUrl: './theme-selector.component.scss',
})
export class ThemeSelectorComponent {
  private readonly preferences = inject(AppPreferencesService);

  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly themeMode = this.preferences.themeMode;
  protected readonly activeOption = computed(
    () =>
      this.themeOptions.find((option) => option.value === this.themeMode()) ?? this.themeOptions[0],
  );
  protected readonly buttonLabel = computed(() => `Theme: ${this.activeOption().label}`);

  protected setThemeMode(mode: ThemeMode): void {
    if (SUPPORTED_THEME_MODES.includes(mode)) {
      this.preferences.setThemeMode(mode);
    }
  }
}
