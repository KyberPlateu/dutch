import { DOCUMENT } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppPreferencesService } from './core/app-preferences.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly document = inject(DOCUMENT);
  private readonly preferences = inject(AppPreferencesService);

  constructor() {
    effect(() => {
      const root = this.document.documentElement;
      const effectiveTheme = this.preferences.effectiveTheme();

      root.dataset['theme'] = effectiveTheme;
      root.dataset['themeMode'] = this.preferences.themeMode();
      root.style.colorScheme = effectiveTheme;
    });
  }
}
